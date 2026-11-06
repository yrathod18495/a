"""12TOONS Kaggle render worker.

Runs inside a Kaggle notebook kernel and calls the Hugging Face Space over HTTPS.
It does not need the Firebase service-account private key.
"""
from __future__ import annotations

import glob
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import requests

try:
    import psutil
except ImportError:
    psutil = None

from playwright.sync_api import sync_playwright

TERMINAL = {"done", "error", "cancelled"}
HEARTBEAT_INTERVAL_SECONDS = 8
POLL_WAIT_SECONDS = 10
# Code-owned Kaggle defaults: no Space Variables/Secrets required for tuning.
KAGGLE_PARALLEL = 4
KAGGLE_IDLE_MINUTES = 3
CPU_ONLY_CORE_THRESHOLD = 40
_HW_MARKERS = ("nvidia", "tesla", "geforce", "quadro", "rtx")
_BASE_ARGS = [
    "--no-sandbox", "--disable-dev-shm-usage",
    # Keep headless render tabs responsive; video encoding is selected by WebCodecs.
    # Headless render tabs must never be throttled as "background" pages.
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    # lets the https render page reach the local GPU-encoder socket (ws://127.0.0.1) - Chrome's Local Network Access would block it
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults",
]
# Keep the NVIDIA Vulkan/GL path for WebGL drawing only. Do not force
# Chromium's experimental Linux VA-API/NVIDIA video-encode flags: this Kaggle
# image exposes NVENC through FFmpeg, but Chromium's WebCodecs hardware encoder
# is not consistently supported for the app's AVC profile. WebCodecs is left
# in its native auto-selection mode so it can choose a working software codec.
_VULKAN_ARGS = [
    "--use-gl=angle", "--use-angle=vulkan",
    "--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE",
    "--ignore-gpu-blocklist", "--disable-gpu-driver-bug-workaround",
    "--disable-vulkan-surface",
]
_GL_ENCODE_ARGS = [
    "--use-gl=angle", "--use-angle=gl",
    "--enable-features=AcceleratedVideoDecodeLinuxGL",
    "--ignore-gpu-blocklist", "--disable-gpu-driver-bug-workaround",
]
_GPU_CANDIDATES = [
    ("chromium", _VULKAN_ARGS),
    ("chromium", _GL_ENCODE_ARGS),
    ("chromium", ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist"]),
    ("chromium", ["--use-gl=egl", "--ignore-gpu-blocklist"]),
    ("chromium", ["--use-gl=angle", "--use-angle=gl", "--enable-gpu", "--enable-webgl", "--ignore-gpu-blocklist"]),
    (None, _VULKAN_ARGS),
    (None, _GL_ENCODE_ARGS),
]

# ---------------------------------------------------------------------------
# NVIDIA graphics userspace packages (Kaggle / Ubuntu host driver).
# Install the matching GL/Vulkan userspace package, not a full .run driver:
# Kaggle already supplies the host kernel driver and nvidia-smi.
# ---------------------------------------------------------------------------
_nv_lock = threading.Lock()
_nv_state: dict[str, Any] = {"done": False, "env": None, "note": ""}


def _find_nvidia_icd() -> str | None:
    """Find the distro-provided NVIDIA Vulkan ICD JSON."""
    candidates = [
        "/usr/share/vulkan/icd.d/nvidia_icd.json",
        "/etc/vulkan/icd.d/nvidia_icd.json",
        "/usr/share/vulkan/icd.d/nvidia_icd.x86_64.json",
        "/etc/vulkan/icd.d/nvidia_icd.x86_64.json",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    for pattern in (
        "/usr/share/vulkan/icd.d/*nvidia*.json",
        "/etc/vulkan/icd.d/*nvidia*.json",
    ):
        for path in sorted(glob.glob(pattern)):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                icd = data.get("ICD", {}) if isinstance(data, dict) else {}
                if isinstance(icd, dict) and icd.get("library_path"):
                    return path
            except Exception:
                continue
    return None


def _find_nvidia_egl_vendor() -> str | None:
    """Find the GLVND EGL vendor manifest installed by libnvidia-gl."""
    candidates = [
        "/usr/share/glvnd/egl_vendor.d/10_nvidia.json",
        "/etc/glvnd/egl_vendor.d/10_nvidia.json",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    for pattern in (
        "/usr/share/glvnd/egl_vendor.d/*nvidia*.json",
        "/etc/glvnd/egl_vendor.d/*nvidia*.json",
    ):
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[0]
    return None


def _setup_nvidia_graphics(driver: str | None) -> tuple[dict[str, str] | None, str]:
    """Install matching NVIDIA GL/Vulkan userspace once and return Chromium env."""
    with _nv_lock:
        if _nv_state["done"]:
            return _nv_state["env"], _nv_state["note"]
        _nv_state["done"] = True
        env: dict[str, str] | None = None
        notes: list[str] = []
        try:
            if not driver:
                raise RuntimeError("nvidia-smi did not provide a driver version")
            major_match = re.match(r"^(\d+)", str(driver).strip())
            if not major_match:
                raise RuntimeError(f"could not parse NVIDIA driver version: {driver!r}")
            major = major_match.group(1)
            print(f"[NV-LIBS] Preparing matching libnvidia-gl-{major} userspace packages...", flush=True)

            apt_env = dict(os.environ)
            apt_env["DEBIAN_FRONTEND"] = "noninteractive"
            apt_env["NEEDRESTART_MODE"] = "a"
            update = subprocess.run(
                ["apt-get", "update", "-q"], capture_output=True, text=True,
                timeout=180, check=False, env=apt_env,
            )
            if update.returncode != 0:
                tail = (update.stderr or update.stdout or "")[-700:]
                raise RuntimeError(f"apt-get update failed ({update.returncode}): {tail}")

            installed = False
            install_errors: list[str] = []
            # Try the normal userspace package first, then the server variant.
            for package in (f"libnvidia-gl-{major}", f"libnvidia-gl-{major}-server"):
                command = ["apt-get", "install", "-y", "-q", package, "libvulkan1", "vulkan-tools"]
                result = subprocess.run(
                    command, capture_output=True, text=True, timeout=360,
                    check=False, env=apt_env,
                )
                if result.returncode == 0:
                    notes.append(f"installed {package}, libvulkan1 and vulkan-tools")
                    installed = True
                    break
                tail = (result.stderr or result.stdout or "")[-500:]
                install_errors.append(f"{package}: exit {result.returncode}: {tail}")
            if not installed:
                raise RuntimeError("NVIDIA GL package install failed. " + " | ".join(install_errors))

            icd = _find_nvidia_icd()
            egl_vendor = _find_nvidia_egl_vendor()
            if not icd and not egl_vendor:
                raise RuntimeError("NVIDIA GL package installed but no NVIDIA Vulkan ICD or EGL vendor manifest was found")

            env = dict(os.environ)
            if icd:
                env["VK_ICD_FILENAMES"] = icd
                env["VK_DRIVER_FILES"] = icd
                notes.append(f"Vulkan ICD: {icd}")
            if egl_vendor:
                env["__EGL_VENDOR_LIBRARY_FILENAMES"] = egl_vendor
                notes.append(f"EGL vendor: {egl_vendor}")

            # Resolve and report the actual Vulkan device; don't treat package
            # installation alone as proof that Chromium can use the GPU.
            vulkan = subprocess.run(
                ["vulkaninfo", "--summary"], capture_output=True, text=True,
                timeout=35, check=False, env=env,
            )
            vulkan_text = (vulkan.stdout or "") + "\n" + (vulkan.stderr or "")
            device_lines = [line.strip() for line in vulkan_text.splitlines()
                            if "deviceName" in line or "GPU id" in line]
            if vulkan.returncode == 0 and device_lines:
                notes.append("vulkaninfo: " + "; ".join(device_lines[:4]))
            else:
                notes.append("vulkaninfo did not confirm a device: " + vulkan_text[-500:].strip())
        except Exception as exc:
            notes.append(f"NVIDIA graphics setup unavailable: {type(exc).__name__}: {exc}")
            env = None

        note = "; ".join(notes)
        _nv_state["env"], _nv_state["note"] = env, note
        print(f"[NV-LIBS] {note}", flush=True)
        return env, note


def _with_gpuenc(url: str, value: str) -> str:
    """Add ?gpuenc=<port>.<token>: the render page then sends its frames to the local ffmpeg/NVENC encoder (gpu_encode.py)."""
    base, sep, frag = url.partition("#")
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["gpuenc"] = value
    out = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))
    return out + (sep + frag if sep else "")


def _gpu_encoder_job():
    """(encoder, port, token) when ffmpeg NVENC encoding works on this machine (GPU_ENCODE=0 switches it off), else None."""
    os.environ.setdefault("GPU_ENCODE", "1")
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import gpu_encode
        enc = gpu_encode.get_encoder()
        return (enc, enc.port, enc.new_job()) if enc else None
    except Exception:
        print("[GPU-ENCODE] not available:\n" + traceback.format_exc(), flush=True)
        return None


def _with_workers(url: str, n: int) -> str:
    """Set the site's ?workers=N frame-worker count (query sits before the #hash route)."""
    base, sep, frag = url.partition("#")
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["workers"] = str(max(1, min(8, n)))
    out = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))
    return out + (sep + frag if sep else "")


def _gpu_info(use_gpu: bool) -> dict[str, Any]:
    if not use_gpu:
        return {"gpu_name": None, "driver": None, "memory_total_mb": None, "gpu_available": False}
    executable = shutil.which("nvidia-smi")
    if not executable:
        return {"gpu_name": None, "driver": None, "memory_total_mb": None,
                "gpu_available": False, "gpu_reason": "GPU was requested, but nvidia-smi was not found; CPU/software rendering will be used."}
    try:
        result = subprocess.run(
            [executable, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            raise RuntimeError(result.stderr.strip() or "nvidia-smi returned no GPU")
        parts = [part.strip() for part in result.stdout.strip().splitlines()[0].split(",")]
        return {
            "gpu_name": parts[0] if parts else "NVIDIA GPU",
            "memory_total_mb": int(float(parts[1])) if len(parts) > 1 else None,
            "driver": parts[2] if len(parts) > 2 else None,
            "gpu_available": True,
        }
    except Exception as exc:
        return {"gpu_name": None, "driver": None, "memory_total_mb": None,
                "gpu_available": False, "gpu_reason": f"GPU probe failed; CPU mode will be used: {exc}"}


def _webgl_renderer(page) -> str:
    try:
        return str(page.evaluate("""() => {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (!gl) return 'WebGL unavailable';
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        }"""))
    except Exception:
        return "WebGL unavailable"


_SOFTWARE_CANDIDATES = [
    # Newer Chromium: SwiftShader is reached through ANGLE; --use-gl=swiftshader is deprecated.
    ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
]


def _has_webgl(renderer: str) -> bool:
    return "unavailable" not in renderer.lower()


def _launch_software_browser(playwright):
    """Launch Chromium with software WebGL (SwiftShader) and verify WebGL really works."""
    last_exc = None
    for channel in ("chromium", None):
        for extra in _SOFTWARE_CANDIDATES:
            browser = None
            try:
                kwargs = {"headless": True, "args": _BASE_ARGS + ["--disable-gpu-sandbox", "--enable-webgl"] + extra}
                if channel:
                    kwargs["channel"] = channel
                browser = playwright.chromium.launch(**kwargs)
                page = browser.new_page()
                renderer = _webgl_renderer(page)
                page.close()
                if _has_webgl(renderer):
                    return browser, f"CPU / SwiftShader ({renderer})"
                print(f"[SW-PROBE] {channel or 'shell'} {extra[:2]} -> {renderer}", flush=True)
                browser.close()
            except Exception as exc:
                last_exc = exc
                print(f"[SW-PROBE] {channel or 'shell'} launch failed: {str(exc)[:180]}", flush=True)
                try:
                    if browser:
                        browser.close()
                except Exception:
                    pass
    raise RuntimeError(f"No WebGL available in Chromium (GPU and SwiftShader both failed): {last_exc}")


BUILD_TAG = "fast-v5-native-webcodecs-fallback"

_probe_lock = threading.Lock()
_cached_cfg: dict[str, Any] | None = None  # {"kwargs":..., "renderer":..., "hw":bool}


def _gpu_kwargs(channel, extra, env):
    kwargs = {"headless": True, "args": _BASE_ARGS + [
        "--enable-gpu", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
        "--enable-gpu-rasterization",
    ] + extra}
    if channel:
        kwargs["channel"] = channel
    if env:
        kwargs["env"] = env
    return kwargs


def _launch_browser(playwright, use_gpu: bool, driver: str | None = None):
    """Create a browser in the calling thread; Playwright objects stay thread-local.

    The winning launch config is probed once per process and then reused, so later
    jobs skip the multi-browser probing (it used to cost ~10-20s per job).
    """
    global _cached_cfg
    if not use_gpu:
        browser, renderer = _launch_software_browser(playwright)
        return browser, f"{renderer} [{BUILD_TAG}]"

    with _probe_lock:
        cfg = _cached_cfg
        if cfg:
            try:
                browser = playwright.chromium.launch(**cfg["kwargs"])
                return browser, f"{cfg['renderer']} [cached, {BUILD_TAG}]"
            except Exception as exc:
                print(f"[GPU-PROBE] cached config failed ({str(exc)[:120]}); re-probing", flush=True)
                _cached_cfg = None

        nv_env, nv_note = _setup_nvidia_graphics(driver)
        if nv_note:
            print(f"[GPU-SETUP] {nv_note}", flush=True)
        candidates = list(_GPU_CANDIDATES)
        if nv_env:
            # Real NVIDIA graphics libs available: try them first (Vulkan, then EGL).
            candidates = [("chromium", _VULKAN_ARGS, nv_env),
                          ("chromium", ["--use-gl=angle", "--use-angle=gl-egl"], nv_env)] + \
                         [(c, e, None) for c, e in candidates]
        else:
            candidates = [(c, e, None) for c, e in candidates]

        fallback = None  # (browser, renderer, kwargs): first candidate with working software WebGL
        for channel, extra, env in candidates:
            browser = None
            try:
                kwargs = _gpu_kwargs(channel, extra, env)
                browser = playwright.chromium.launch(**kwargs)
                page = browser.new_page()
                renderer = _webgl_renderer(page)
                page.close()
                print(f"[GPU-PROBE] {channel or 'shell'} {extra[1] if len(extra) > 1 else extra[0]}"
                      f"{' +nvlibs' if env else ''} -> {renderer}", flush=True)
                if any(marker in renderer.lower() for marker in _HW_MARKERS) and "llvmpipe" not in renderer.lower():
                    if fallback:
                        fallback[0].close()
                    _cached_cfg = {"kwargs": kwargs, "renderer": renderer, "hw": True}
                    return browser, f"{renderer} [HARDWARE WebGL, {BUILD_TAG}]"
                if _has_webgl(renderer) and fallback is None:
                    fallback = (browser, renderer, kwargs)
                else:
                    browser.close()
            except Exception as exc:
                print(f"[GPU-PROBE] {channel or 'shell'} launch failed: {str(exc)[:180]}", flush=True)
                try:
                    if browser:
                        browser.close()
                except Exception:
                    pass

        if fallback:
            _cached_cfg = {"kwargs": fallback[2], "renderer": fallback[1], "hw": False}
            return fallback[0], f"{fallback[1]} [software WebGL, {BUILD_TAG}]"
        browser, renderer = _launch_software_browser(playwright)
        return browser, f"{renderer} [GPU fallback, {BUILD_TAG}]"


def _nvenc_utilization() -> float | None:
    """Return the highest per-GPU NVENC engine utilization, when NVML exposes it."""
    smi = shutil.which("nvidia-smi")
    if not smi:
        return None
    try:
        result = subprocess.run(
            [smi, "--query-gpu=utilization.encoder", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        if result.returncode != 0:
            return None
        values = []
        for line in result.stdout.splitlines():
            try:
                values.append(float(line.strip().split()[0]))
            except (ValueError, IndexError):
                continue
        return max(values) if values else None
    except Exception:
        return None


def _probe_ffmpeg_nvenc() -> dict[str, Any]:
    """Verify FFmpeg NVENC availability; this diagnostic is not the render encoder."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        note = "FFmpeg not installed; direct NVENC path not available for benchmark."
        print(f"[NVENC] {note}", flush=True)
        return {"available": False, "reason": note}
    try:
        encoders = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True,
            timeout=12, check=False,
        )
        encoder_text = (encoders.stdout or "") + (encoders.stderr or "")
        if "h264_nvenc" not in encoder_text:
            note = "Installed FFmpeg build does not expose h264_nvenc."
            print(f"[NVENC] {note}", flush=True)
            return {"available": False, "reason": note}
        started = time.perf_counter()
        test = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "warning",
             "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60",
             "-frames:v", "120", "-an", "-c:v", "h264_nvenc", "-preset", "p4",
             "-pix_fmt", "yuv420p", "-f", "null", "-"],
            capture_output=True, text=True, timeout=45, check=False,
        )
        elapsed = time.perf_counter() - started
        if test.returncode == 0:
            speed = (120.0 / elapsed / 60.0) if elapsed > 0 else 0.0
            note = f"H.264 NVENC diagnostic PASS: 120 synthetic 720p frames encoded in {elapsed:.2f}s ({speed:.1f}x 60-fps realtime); this test does not encode the active browser render."
            print(f"[NVENC] {note}", flush=True)
            return {"available": True, "elapsed_seconds": round(elapsed, 3), "reason": note}
        detail = ((test.stderr or test.stdout or "NVENC test failed")[-700:]).strip()
        note = f"H.264 NVENC encoder listed but smoke test FAILED: {detail}"
        print(f"[NVENC] {note}", flush=True)
        return {"available": False, "reason": note}
    except Exception as exc:
        note = f"NVENC smoke test error: {type(exc).__name__}: {exc}"
        print(f"[NVENC] {note}", flush=True)
        return {"available": False, "reason": note}


# Do not monkey-patch VideoEncoder. Earlier builds forced
# hardwareAcceleration="prefer-hardware" in configure(), even when
# isConfigSupported() had reported that the hardware profile was unsupported.
# Encoder creation can fail asynchronously after configure(), so a try/catch
# around configure() is not a valid fallback. Native WebCodecs selection is the
# safe path here; the diagnostic probe below is read-only.


def _fleet_metrics(use_gpu: bool) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    if psutil:
        try:
            memory = psutil.virtual_memory()
            metrics.update(
                cpu=psutil.cpu_percent(None),
                cores=psutil.cpu_count(),
                ram_used=round(memory.used / 1e9, 2),
                ram_total=round(memory.total / 1e9, 2),
            )
        except Exception:
            pass
    if use_gpu:
        executable = shutil.which("nvidia-smi")
        if executable:
            try:
                result = subprocess.run(
                    [executable, "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5, check=False,
                )
                if result.returncode == 0 and result.stdout.strip():
                    values = [value.strip() for value in result.stdout.strip().splitlines()[0].split(",")]
                    def number(value: str) -> float | None:
                        try:
                            return float(value)
                        except (TypeError, ValueError):
                            return None
                    metrics.update(
                        gpu_util=number(values[0]) if len(values) > 0 else None,
                        vram_used=number(values[1]) if len(values) > 1 else None,
                        vram_total=number(values[2]) if len(values) > 2 else None,
                        temp=number(values[3]) if len(values) > 3 else None,
                        power=number(values[4]) if len(values) > 4 else None,
                    )
            except Exception:
                pass
    if use_gpu:
        encoder_util = _nvenc_utilization()
        if encoder_util is not None:
            metrics["gpu_encoder_util"] = encoder_util
    return metrics


class KaggleRenderWorker:
    def __init__(self, space_url: str, hf_token: str):
        self.base_url = space_url.rstrip("/")
        if not hf_token:
            raise ValueError("HF_ACCESS_TOKEN is required to reach this private Hugging Face Space.")
        self.headers = {"Authorization": f"Bearer {hf_token}"}
        self.cpu_cores = os.cpu_count() or 1
        # Prefer the Kaggle GPU on normal 4-core workers. Only switch the
        # Chromium render path to CPU on unusually large (more than 40 logical-core) hosts.
        self.use_gpu = self.cpu_cores <= CPU_ONLY_CORE_THRESHOLD
        self.parallel = KAGGLE_PARALLEL
        self.gpu = _gpu_info(self.use_gpu)
        self.account_name = os.environ.get("ACCOUNT_NAME", "").strip() or f"kaggle-{os.uname().nodename[:8]}"
        self.active: dict[str, dict[str, Any]] = {}
        self.active_lock = threading.RLock()
        self.done = 0
        self.failed = 0
        self.last_took: float | None = None
        self.last_error = ""
        self.stop_requested = False
        self.last_busy = time.time()
        self.last_report = 0.0
        self.idle_exit_min = KAGGLE_IDLE_MINUTES

    def _request(self, method: str, path: str, **kwargs):
        timeout = kwargs.pop("timeout", 25)
        response = requests.request(
            method, f"{self.base_url}{path}", headers=self.headers,
            timeout=timeout, **kwargs,
        )
        response.raise_for_status()
        return response.json() if response.content else {}

    def _fleet_report(self) -> None:
        with self.active_lock:
            active_rows = list(self.active.values())
        current = active_rows[0] if active_rows else {}
        progress = (sum(float(row.get("progress") or 0) for row in active_rows) / len(active_rows)) if active_rows else 0.0
        elapsed = max((float(row.get("elapsed_seconds") or 0) for row in active_rows), default=0.0)
        payload = {
            "agent_id": self.account_name,
            "name": self.account_name,
            "gpu_name": self.gpu.get("gpu_name"),
            "driver": self.gpu.get("driver"),
            "webgl": current.get("webgl") or ("CPU / SwiftShader" if not self.use_gpu or not self.gpu.get("gpu_available") else "GPU requested"),
            "job": current.get("job_id"),
            "phase": current.get("phase") or (f"{len(active_rows)} jobs active" if active_rows else "idle"),
            "progress": progress,
            "elapsed_seconds": elapsed,
            "jobs": [
                {
                    "job_id": row.get("job_id"),
                    "phase": row.get("phase") or "working",
                    "progress": row.get("progress") or 0,
                    "elapsed_seconds": row.get("elapsed_seconds") or 0,
                    "webgl": row.get("webgl") or "",
                }
                for row in active_rows[:4]
            ],
            "parallel": self.parallel,
            "done": self.done,
            "failed": self.failed,
            "last_took": self.last_took,
            "last_error": self.last_error,
            **_fleet_metrics(self.use_gpu and self.gpu.get("gpu_available", False)),
        }
        response = self._request("POST", "/api/fleet/report", json=payload, timeout=8)
        encoder_util = payload.get("gpu_encoder_util")
        if encoder_util is not None and active_rows:
            stamp = int(time.time() // 24)  # coarse log throttle: one sample per ~24 seconds
            if getattr(self, "_last_encoder_log_stamp", None) != stamp:
                self._last_encoder_log_stamp = stamp
                self._log(None, f"NVIDIA encoder engine utilization: {encoder_util:.0f}% (0% means no NVENC session activity at sample time).", stage="metrics")
        self.last_report = time.time()
        if isinstance(response, dict) and response.get("stop"):
            if not self.stop_requested:
                self._log(None, "Stop requested from Fleet dashboard; finishing active jobs before exit.")
            self.stop_requested = True

    def _log(self, job_id: str | None, message: str, level: str = "INFO", stage: str = "job") -> None:
        line = f"[{level}] {message}"
        print(f"[{self.account_name}] {line}", flush=True)
        if level == "ERROR":
            self.last_error = str(message)[:500]
        try:
            self._request("POST", "/api/fleet/log", json={
                "name": self.account_name,
                "job_id": job_id or "",
                "stage": stage,
                "lines": [line],
            }, timeout=8)
        except Exception as exc:
            print(f"[LOG-POST-FAILED] {exc}", flush=True)
        if job_id:
            try:
                self._request("POST", f"/api/kaggle/jobs/{quote(job_id, safe='')}/log",
                              json={"message": message, "level": level}, timeout=8)
            except Exception:
                pass

    def _process_job(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        render_url = str(job["render_url"])
        started = time.time()
        try:
            render_seconds = float(job.get("seconds") or 30)
            if not math.isfinite(render_seconds) or render_seconds <= 0:
                raise ValueError("invalid render seconds")
        except (TypeError, ValueError):
            render_seconds = 30.0
        timeout_seconds = max(300, min(24 * 60 * 60, render_seconds) * 20 + 180)
        state = {"job_id": job_id, "phase": "starting", "progress": 0.0,
                 "elapsed_seconds": 0.0, "webgl": ""}
        with self.active_lock:
            self.active[job_id] = state
        final_status = "completed"
        error_text = ""
        browser = None
        context = None
        gpu_job = None
        try:
            self._log(job_id, f"Starting Kaggle render job {job_id}; USE_GPU={int(self.use_gpu)}, PARALLEL={self.parallel}.")
            if self.gpu.get("gpu_reason"):
                self._log(job_id, self.gpu["gpu_reason"], level="WARN")
            with sync_playwright() as playwright:
                browser, renderer = _launch_browser(playwright, self.use_gpu and self.gpu.get("gpu_available", False), self.gpu.get("driver"))
                state["webgl"] = renderer
                self._log(job_id, f"Chromium renderer: {renderer}.")
                if self.use_gpu and self.gpu.get("gpu_available") and not any(marker in renderer.lower() for marker in _HW_MARKERS):
                    self._log(job_id, "NVIDIA GPU is visible to nvidia-smi, but Chromium selected a software renderer. GPU acceleration is not active for this job.", level="WARN")
                context = browser.new_context(viewport={"width": 960, "height": 720})
                page = context.new_page()
                page.on("console", lambda msg: self._log(job_id, f"browser: {msg.text[:280]}")
                        if "dragonbones.com" not in msg.text.lower() and not msg.text.startswith("DragonBones:") else None)
                page.on("pageerror", lambda err: self._log(job_id, f"Browser page error: {err}", level="ERROR"))
                page.on("requestfailed", lambda req: self._log(
                    job_id, f"Request failed: {req.method} {req.url[:350]} | {req.failure or 'unknown'}", level="WARN"))
                page.on("response", lambda resp: self._log(
                    job_id, f"HTTP {resp.status}: {resp.url[:350]}", level="WARN") if resp.status >= 400 else None)
                # Leave VideoEncoder untouched. The browser chooses a supported
                # encoder implementation; forcing prefer-hardware caused
                # asynchronous Encoder creation errors on Tesla T4/Chromium.
                self._log(job_id, "WebCodecs policy: native browser selection (no hardware override; software fallback allowed).")
                with self.active_lock:
                    concurrent = max(1, len(self.active))
                env_workers = os.environ.get("RENDER_FRAME_WORKERS", "").strip()
                workers = int(env_workers) if env_workers.isdigit() else max(1, self.cpu_cores // concurrent)
                render_url = _with_workers(render_url, workers)
                if self.use_gpu and self.gpu.get("gpu_available", False) and any(m in renderer.lower() for m in _HW_MARKERS):
                    gpu_job = _gpu_encoder_job()
                    if gpu_job:
                        render_url = _with_gpuenc(render_url, f"{gpu_job[1]}.{gpu_job[2]}")
                        self._log(job_id, f"GPU video encoding ON (ffmpeg NVENC, port {gpu_job[1]}). Set GPU_ENCODE=0 to use the browser's own encoder.")
                    else:
                        self._log(job_id, "GPU video encoding is not available here; the browser's own encoder is used.", level="WARN")
                self._log(job_id, f"Frame workers: {max(1, min(8, workers))} ({self.cpu_cores} cores / {concurrent} active job(s)).")
                page.goto(render_url, wait_until="load", timeout=60_000)
                try:
                    codec_probe = page.evaluate("""async () => {
                      if (!globalThis.VideoEncoder) return {available:false, reason:'WebCodecs VideoEncoder API unavailable'};
                      const rows = [];
                      const codecs = ['avc1.640033','avc1.640028','avc1.4D0028','avc1.42E01E'];
                      const modes = [
                        {name:'browser-default', extra:{}},
                        {name:'prefer-hardware', extra:{hardwareAcceleration:'prefer-hardware'}},
                        {name:'prefer-software', extra:{hardwareAcceleration:'prefer-software'}}
                      ];
                      for (const codec of codecs) {
                        for (const mode of modes) {
                          try {
                            const config = {codec, width:1280, height:720,
                              bitrate:8000000, framerate:30, ...mode.extra};
                            const result = await VideoEncoder.isConfigSupported(config);
                            rows.push({codec, mode:mode.name, supported:!!result.supported,
                              returnedAcceleration:(result.config && result.config.hardwareAcceleration) || 'not reported'});
                          } catch (error) {
                            rows.push({codec, mode:mode.name, supported:false, error:String(error)});
                          }
                        }
                      }
                      return {available:true, diagnosticOnly:true, codecs:rows};
                    }""")
                    self._log(job_id, "WebCodecs capability matrix (read-only; no encoder settings changed): " + json.dumps(codec_probe, separators=(",", ":")))
                except Exception as exc:
                    self._log(job_id, f"WebCodecs capability probe failed: {exc}", level="WARN")
                self._log(job_id, "Render page opened; waiting for Firebase progress updates.")
                last_signature = None
                last_change = time.time()
                while time.time() - started < timeout_seconds:
                    result = self._request("GET", f"/api/kaggle/jobs/{quote(job_id, safe='')}/status", timeout=12)
                    status = str(result.get("status") or "pending")
                    phase = str(result.get("phase") or status)
                    try:
                        progress = float(result.get("progress") or 0)
                    except (TypeError, ValueError):
                        progress = 0.0
                    progress = progress / 100.0 if progress > 1.0 else progress
                    progress = max(0.0, min(1.0, progress))
                    state.update(phase=phase, progress=progress, elapsed_seconds=round(time.time() - started, 1))
                    signature = (status, phase, round(progress, 3))
                    if signature != last_signature:
                        self._log(job_id, f"{status} | {phase} | {progress:.0%}.")
                        last_signature, last_change = signature, time.time()
                    elif time.time() - last_change > 120:
                        self._log(job_id, f"No progress update for 2 minutes; phase={phase}, progress={progress:.0%}.", level="WARN")
                        last_change = time.time()
                    if status in TERMINAL:
                        if status == "error":
                            final_status = "error"
                            error_text = str(result.get("error") or "Firebase marked this export as error.")
                        break
                    if page.is_closed():
                        raise RuntimeError("Chromium page closed before the export completed.")
                    page.wait_for_timeout(2500)
                else:
                    raise TimeoutError(f"Render exceeded {timeout_seconds:.0f} seconds.")
        except Exception as exc:
            final_status = "error"
            error_text = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-2500:]}"
            self._log(job_id, f"Render failed: {type(exc).__name__}: {exc}", level="ERROR")
        finally:
            if gpu_job:
                try:
                    gpu_job[0].end_job(gpu_job[2])
                except Exception:
                    pass
            if context is not None:
                try:
                    context.close()
                except Exception:
                    pass
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass
            try:
                self._request("POST", f"/api/kaggle/jobs/{quote(job_id, safe='')}/complete",
                              json={"status": final_status, "error": error_text}, timeout=15)
            except Exception as exc:
                self._log(job_id, f"Could not release job claim: {exc}", level="ERROR")
            elapsed = time.time() - started
            with self.active_lock:
                self.active.pop(job_id, None)
            self.last_took = round(elapsed, 2)
            self.last_busy = time.time()
            if final_status == "error":
                self.failed += 1
                self.last_error = error_text[:500]
                self._log(job_id, f"Job failed after {elapsed:.1f}s: {error_text[:700]}", level="ERROR")
            else:
                self.done += 1
                self._log(job_id, f"Job finished with status={final_status} in {elapsed:.1f}s.")

    def run(self) -> None:
        if self.use_gpu and self.gpu.get("gpu_available"):
            print(f"GPU: {self.gpu.get('gpu_name')} | VRAM: {self.gpu.get('memory_total_mb')} MB | Driver: {self.gpu.get('driver')}", flush=True)
            # Install/verify graphics userspace once during worker boot, before
            # the first render is claimed; the browser launch then reuses cache.
            _, setup_note = _setup_nvidia_graphics(self.gpu.get("driver"))
            if setup_note:
                print(f"[GPU-SETUP] {setup_note}", flush=True)
            self.nvenc_probe = _probe_ffmpeg_nvenc()
        else:
            if not self.use_gpu:
                print(f"Detected {self.cpu_cores} logical CPU cores (threshold {CPU_ONLY_CORE_THRESHOLD}); selecting CPU-only rendering. nvidia-smi will not be called.", flush=True)
            else:
                print(self.gpu.get("gpu_reason", "GPU unavailable; CPU fallback selected."), flush=True)
            self.nvenc_probe = {"available": False, "reason": "GPU not selected or unavailable."}
        if psutil:
            try:
                psutil.cpu_percent(None)
            except Exception:
                pass

        retry = 2.0
        futures: set[Future] = set()
        with ThreadPoolExecutor(max_workers=self.parallel, thread_name_prefix="kaggle-render") as pool:
            print(f"Connected as {self.account_name}; PARALLEL={self.parallel}; logical CPUs={self.cpu_cores}; GPU requested={int(self.use_gpu)}; idle exit={self.idle_exit_min:g} min.", flush=True)
            while True:
                futures = {future for future in futures if not future.done()}
                try:
                    if time.time() - self.last_report >= HEARTBEAT_INTERVAL_SECONDS:
                        self._fleet_report()
                        retry = 2.0
                except requests.RequestException as exc:
                    delay = min(30.0, retry) + random.uniform(0, min(2.0, retry / 3))
                    print(f"[RECONNECT] Could not report to Space: {exc}; retrying in {delay:.1f}s", flush=True)
                    time.sleep(delay)
                    retry = min(30.0, retry * 2)
                    continue
                if self.stop_requested and not futures:
                    break
                if self.idle_exit_min and not futures and not self.active and time.time() - self.last_busy > self.idle_exit_min * 60:
                    self._log(None, f"No jobs for {self.idle_exit_min:g} minutes; shutting down to save Kaggle quota.", stage="idle")
                    break
                if self.stop_requested or len(futures) >= self.parallel:
                    time.sleep(1)
                    continue
                try:
                    result = self._request(
                        "GET", f"/api/kaggle/next?wait={POLL_WAIT_SECONDS}&agent_id={quote(self.account_name, safe='')}",
                        timeout=POLL_WAIT_SECONDS + 15,
                    )
                    job = result.get("job")
                    if job:
                        self._log(str(job.get("id") or ""), f"Job assigned by Space; {len(futures) + 1}/{self.parallel} slots in use.")
                        futures.add(pool.submit(self._process_job, job))
                    else:
                        time.sleep(0.3)
                except requests.RequestException as exc:
                    delay = min(30.0, retry) + random.uniform(0, min(2.0, retry / 3))
                    print(f"[RECONNECT] Space connection failed: {exc}; retrying in {delay:.1f}s", flush=True)
                    time.sleep(delay)
                    retry = min(30.0, retry * 2)
                except KeyboardInterrupt:
                    print("Kaggle worker interrupted; waiting for active jobs to finish.", flush=True)
                    self.stop_requested = True
                except Exception as exc:
                    self.last_error = f"{type(exc).__name__}: {exc}"[:500]
                    self._log(None, f"Worker loop error: {self.last_error}", level="ERROR")
                    time.sleep(3)
        print("Kaggle worker stopped.", flush=True)


def main() -> None:
    space_url = os.environ.get("HF_SPACE_URL", "").strip()
    hf_token = os.environ.get("HF_ACCESS_TOKEN", "").strip()
    if not space_url.startswith("https://"):
        raise ValueError("HF_SPACE_URL must be set and start with https://")
    if not hf_token:
        raise ValueError("HF_ACCESS_TOKEN is required for a private Hugging Face Space (READ permission).")
    KaggleRenderWorker(space_url, hf_token).run()


if __name__ == "__main__":
    main()
