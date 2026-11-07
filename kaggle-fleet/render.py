"""12TOONS cloud-render worker with a small live dashboard.

The worker watches Firebase cloudExports for pending jobs, opens the site's
private cloud-render route in headless Chromium, and waits for the website to
write status/progress updates. Video encoding uses the website/browser's normal
built-in path. If the Space exposes NVIDIA hardware it is used for WebGL
rendering only.
"""
from __future__ import annotations

import ctypes.util
import glob
import copy
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import firebase_admin
from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.responses import HTMLResponse, FileResponse
from firebase_admin import credentials, db
from playwright.sync_api import sync_playwright

from fleet import (
    KAGGLE_PARALLEL, _agents as _fleet_agents, _auto_suppressed_accounts, _suppressed_at,
    _boot as _fleet_boot, _stop_req, router as fleet_router,
    selected_account_number, start_kaggle_account, maybe_rotate, select_kaggle_account, _account_numbers as _fleet_account_numbers,
)
import fleet as _fleet_module
_fleet_module.ON_KERNEL_BOOT = lambda name: _mark_pending_phase("machine_starting")          # the kernel itself said it booted: only now the website may say a machine is starting
_fleet_module.USAGE_REF = lambda path: db.reference(path)          # where the free-hours counters are saved (Firebase fleetUsage/)

# These defaults can be overridden with Space Variables if project URLs change.
FIREBASE_DATABASE_URL = os.environ.get(
    "FIREBASE_DATABASE_URL",
    "https://twelvelabs-studio-209137-11a91-default-rtdb.firebaseio.com/",
)
SITE_URL = os.environ.get("SITE_URL", "https://a-two-roan-17.vercel.app").rstrip("/")
PROFILE_DIR = os.environ.get("PROFILE_DIR", "/tmp/12toons-render-profile")
POLL_SECONDS = max(5, int(os.environ.get("POLL_SECONDS", "30")))
MAX_CONCURRENT = max(1, min(4, int(os.environ.get("MAX_CONCURRENT", "1"))))
CLOUD_RENDER_WORKERS = int(os.environ.get("CLOUD_RENDER_WORKERS", "0"))
TERMINAL = {"done", "error", "cancelled"}
LOG_LIMIT = 700

# In-memory dashboard/worker state.
_log_lock = threading.Lock()
_logs: deque[dict[str, Any]] = deque(maxlen=LOG_LIMIT)
_log_id = 0
_state_lock = threading.RLock()
_worker_thread: threading.Thread | None = None
_worker_stop = threading.Event()
_worker_state = "stopped"
_worker_error = ""
_firebase_ready = False
_active_jobs: dict[str, dict[str, Any]] = {}
_active_lock = threading.RLock()
_queue_count: int | None = None
_gpu_cache: dict[str, Any] = {"available": False, "name": "Not detected", "utilization_percent": None, "memory_used_mb": None, "memory_total_mb": None, "driver": None, "reason": "Not checked"}
_gpu_cache_at = 0.0
_gpu_cache_lock = threading.Lock()
_gpu_test_lock = threading.Lock()
_gpu_test_result: dict[str, Any] = {"tested": False, "ok": False, "message": "GPU self-test has not been run yet."}

# Private Space access is enforced by Hugging Face itself. Kaggle workers use
# HF_ACCESS_TOKEN (READ) through Authorization: Bearer; no custom bridge token.
KAGGLE_STALE_AFTER_SECONDS = max(40, int(os.environ.get("KAGGLE_STALE_AFTER_SECONDS", "60")))
AUTO_START_KAGGLE = os.environ.get("AUTO_START_KAGGLE", "1").strip().lower() not in {"0", "false", "no", "off"}
KAGGLE_START_GRACE_SECONDS = max(60, int(os.environ.get("KAGGLE_START_GRACE_SECONDS", "420")))
_kaggle_lock = threading.RLock()
_kaggle_claims: dict[str, dict[str, Any]] = {}  # job_id -> {uid, agent_id, claimed_at}
# One independent auto-start lease per configured Kaggle account.
_kaggle_start_requested_at: dict[int, float] = {}
_kaggle_start_inflight_accounts: set[int] = set()
_kaggle_start_failed_accounts: set[int] = set()
_kaggle_start_failed_at: dict[int, float] = {}
KAGGLE_RETRY_AFTER_SECONDS = 120          # a failed automatic start is tried again after this long while requests are still waiting
_skip_logged_at: dict[int, float] = {}

# Realtime Database SSE listener: one initial cloudExports snapshot, then only
# changed paths. All routers/worker loops read this in-memory mirror.
_queue_lock = threading.RLock()
_queue_condition = threading.Condition(_queue_lock)
_queue_snapshot: dict[str, Any] = {}
_queue_ready = threading.Event()
_queue_listener: Any = None
_queue_stream_error = ""


def log(message: str, level: str = "INFO") -> None:
    """Write to Docker logs and keep a bounded copy for the live dashboard."""
    global _log_id
    stamp = datetime.now().strftime("%H:%M:%S")
    safe_message = str(message).replace("\x00", "")
    line = f"[{stamp}] [{level}] {safe_message}"
    print(line, flush=True)
    with _log_lock:
        _log_id += 1
        _logs.append({"id": _log_id, "time": stamp, "level": level, "message": safe_message})


def _service_account_from_secret() -> dict[str, Any]:
    raw = os.environ.get("KEY_JSON", "").strip()
    if not raw:
        raise RuntimeError("KEY_JSON Secret is missing. Add the full Firebase service-account JSON as a Space Secret.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("KEY_JSON is not valid JSON. Paste the complete service-account JSON as the Secret value.") from exc
    if data.get("type") != "service_account" or not data.get("private_key"):
        raise RuntimeError("KEY_JSON is not a valid Firebase service-account JSON (type/private_key missing).")
    return data


def _set_nested(node: dict[str, Any], parts: list[str], value: Any) -> dict[str, Any]:
    if not parts:
        return value if isinstance(value, dict) else {}
    cursor = node
    for part in parts[:-1]:
        child = cursor.get(part)
        if not isinstance(child, dict):
            child = {}
            cursor[part] = child
        cursor = child
    if value is None:
        cursor.pop(parts[-1], None)
    else:
        cursor[parts[-1]] = value
    return node


def _on_cloud_exports_event(event: Any) -> None:
    global _queue_snapshot, _queue_stream_error
    # firebase_admin.db.listen() supplies a db.Event object, not a plain dict.
    if isinstance(event, dict):
        event_type = str(event.get("event") or event.get("event_type") or "").lower()
        path = str(event.get("path") or "/")
        data = event.get("data")
    else:
        event_type = str(getattr(event, "event_type", "") or "").lower()
        path = str(getattr(event, "path", "/") or "/")
        data = getattr(event, "data", None)
    parts = [part for part in path.split("/") if part]
    if event_type in {"cancel", "auth_revoked"}:
        _queue_stream_error = str(data or event_type)
        log(f"Firebase cloudExports listener reported {event_type}: {_queue_stream_error}", "ERROR")
        return
    with _queue_condition:
        if event_type == "put":
            _queue_snapshot = _set_nested(_queue_snapshot, parts, copy.deepcopy(data))
        elif event_type == "patch":
            target = _queue_snapshot
            for part in parts:
                child = target.get(part) if isinstance(target, dict) else None
                if not isinstance(child, dict):
                    child = {}
                    target[part] = child
                target = child
            if isinstance(data, dict):
                for patch_path, patch_value in data.items():
                    subparts = [part for part in str(patch_path).split("/") if part]
                    _queue_snapshot = _set_nested(_queue_snapshot, parts + subparts, copy.deepcopy(patch_value))
        # A root put is Firebase's initial full snapshot. Do not start the
        # router on an isolated delta received before the cache is initialized.
        if event_type == "put" and not parts:
            _queue_ready.set()
        _queue_condition.notify_all()
    _queue_stream_error = ""


def start_queue_listener() -> bool:
    global _queue_listener, _queue_stream_error
    try:
        _queue_ready.clear()
        _queue_listener = db.reference("cloudExports").listen(_on_cloud_exports_event)
        if not _queue_ready.wait(timeout=35):
            _queue_stream_error = "Firebase Realtime Database listener did not deliver its initial snapshot within 35 seconds."
            log(_queue_stream_error, "ERROR")
            return False
        log("Firebase cloudExports live listener ready: one initial snapshot, then delta events only.")
        return True
    except Exception as exc:
        _queue_stream_error = str(exc)
        log(f"Firebase cloudExports live listener failed: {exc}", "ERROR")
        return False


def stop_queue_listener() -> None:
    global _queue_listener
    listener = _queue_listener
    _queue_listener = None
    if listener is not None:
        try:
            listener.close()
        except Exception as exc:
            log(f"Could not close Firebase queue listener cleanly: {exc}", "WARN")


def _get_queue_snapshot() -> dict[str, Any]:
    with _queue_lock:
        return copy.deepcopy(_queue_snapshot)


def _get_queue_job(uid: str, job_id: str) -> dict[str, Any]:
    with _queue_lock:
        rows = _queue_snapshot.get(str(uid), {})
        job = rows.get(str(job_id), {}) if isinstance(rows, dict) else {}
        return copy.deepcopy(job) if isinstance(job, dict) else {}


def _claim_pending_job(uid: str, job_id: str, source: str, worker_id: str) -> dict[str, Any] | None:
    """Atomically claim a pending Firebase export and mirror the result locally.

    One RTDB transaction per assigned job prevents HF and Kaggle from starting
    the same pending export, including across Space restarts. Normal polling and
    progress reads continue to use the in-memory SSE mirror.
    """
    global _queue_snapshot
    claim_id = f"{source}:{worker_id}:{time.time_ns()}"
    claimed_at = int(time.time() * 1000)
    ref = db.reference(f"cloudExports/{uid}/{job_id}")

    def claim(current: Any) -> Any:
        if not isinstance(current, dict) or str(current.get("status") or "").lower() != "pending":
            return current
        updated = dict(current)
        updated.update({
            "status": "rendering",
            "workerSource": source,
            "workerId": worker_id,
            "workerClaimId": claim_id,
            "workerClaimedAt": claimed_at,
            "updatedAt": claimed_at,
        })
        return updated

    result = ref.transaction(claim)
    if not isinstance(result, dict) or result.get("workerClaimId") != claim_id:
        return None

    with _queue_condition:
        _queue_snapshot = _set_nested(_queue_snapshot, [str(uid), str(job_id)], copy.deepcopy(result))
        _queue_condition.notify_all()
    return result


def _patch_cached_job(uid: str, job_id: str, updates: dict[str, Any]) -> None:
    """Apply a local copy of a Firebase update while the SSE event is in flight."""
    global _queue_snapshot
    with _queue_condition:
        current = _queue_snapshot.get(str(uid), {})
        row = current.get(str(job_id), {}) if isinstance(current, dict) else {}
        merged = dict(row) if isinstance(row, dict) else {}
        merged.update(updates)
        _queue_snapshot = _set_nested(_queue_snapshot, [str(uid), str(job_id)], merged)
        _queue_condition.notify_all()


def _remove_cached_job(uid: str, job_id: str) -> None:
    """Mirror an RTDB deletion locally so cleanup does not repeat writes."""
    global _queue_snapshot
    with _queue_condition:
        _queue_snapshot = _set_nested(_queue_snapshot, [str(uid), str(job_id)], None)
        _queue_condition.notify_all()


def _wait_for_queue_change(seconds: float) -> None:
    with _queue_condition:
        _queue_condition.wait(timeout=max(0.1, seconds))


def init_firebase() -> bool:
    global _firebase_ready, _worker_error
    try:
        if firebase_admin._apps:
            # The default app may already exist after a reload in the same process.
            firebase_admin.get_app()
        else:
            firebase_admin.initialize_app(
                credentials.Certificate(_service_account_from_secret()),
                {"databaseURL": FIREBASE_DATABASE_URL},
            )
        _firebase_ready = True
        _worker_error = ""
        log("Firebase credentials loaded and admin SDK initialized.")
        log(f"Firebase database configured: {FIREBASE_DATABASE_URL}")
        log(f"Render website configured: {SITE_URL}")
        return True
    except Exception as exc:
        _firebase_ready = False
        _worker_error = str(exc)
        log(f"Firebase setup failed: {exc}", "ERROR")
        return False


def _safe_job_seconds(job: dict[str, Any]) -> float:
    try:
        seconds = float(job.get("seconds") or 30)
    except (TypeError, ValueError):
        return 30.0
    if not math.isfinite(seconds) or seconds <= 0:
        return 30.0
    return min(seconds, 24 * 60 * 60)


def job_timeout_seconds(job: dict[str, Any]) -> int:
    # A generous ceiling for long browser renders; final progress comes from Firebase.
    seconds = _safe_job_seconds(job)
    return max(300, int(seconds * 20 + 180))


def _find_nvidia_smi() -> str | None:
    """Locate nvidia-smi even when the CUDA image uses a non-standard PATH."""
    found = shutil.which("nvidia-smi")
    if found:
        return found
    for candidate in (
        "/usr/bin/nvidia-smi",
        "/usr/local/bin/nvidia-smi",
        "/usr/local/nvidia/bin/nvidia-smi",
        "/usr/local/cuda/bin/nvidia-smi",
    ):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _nvidia_device_nodes() -> list[str]:
    """Return exposed NVIDIA character devices (if the container runtime mounted them)."""
    paths = sorted(set(glob.glob("/dev/nvidia*") + glob.glob("/dev/dri/renderD*")))
    return [path for path in paths if os.path.exists(path)]


def _probe_nvidia_cli() -> dict[str, Any]:
    path = _find_nvidia_smi()
    if not path:
        return {"found": False, "path": None, "ok": False, "output": "nvidia-smi executable not found in the container."}
    try:
        result = subprocess.run([path, "-L"], capture_output=True, text=True, timeout=8, check=False)
        output = (result.stdout or result.stderr or "").strip()
        return {"found": True, "path": path, "ok": result.returncode == 0 and "GPU" in result.stdout, "output": output or f"nvidia-smi exit code {result.returncode}"}
    except Exception as exc:
        return {"found": True, "path": path, "ok": False, "output": f"nvidia-smi probe error: {exc}"}


def nvidia_gpu_available() -> bool:
    """Detect GPU visibility in this running Space; WebGL test is the final rendering check."""
    status = get_gpu_status(force=True)
    return bool(status.get("available"))


def get_gpu_status(force: bool = False) -> dict[str, Any]:
    """Probe the running container, distinguishing missing tooling from missing GPU devices."""
    global _gpu_cache, _gpu_cache_at
    now = time.time()
    with _gpu_cache_lock:
        if not force and now - _gpu_cache_at < 5:
            return dict(_gpu_cache)

        smi_path = _find_nvidia_smi()
        devices = _nvidia_device_nodes()
        cli = _probe_nvidia_cli()
        cuda_driver_lib = ctypes.util.find_library("cuda")
        base: dict[str, Any] = {
            "available": bool(cli.get("ok") or any(re.fullmatch(r"/dev/nvidia\d+", x) for x in devices)),
            "name": "NVIDIA GPU visible" if (cli.get("ok") or devices) else "GPU runtime not visible",
            "utilization_percent": None,
            "memory_used_mb": None,
            "memory_total_mb": None,
            "driver": None,
            "nvidia_smi_found": bool(smi_path),
            "nvidia_smi_path": smi_path,
            "nvidia_smi_output": cli.get("output"),
            "device_nodes": devices,
            "cuda_driver_library": cuda_driver_lib,
            "nvidia_visible_devices": os.environ.get("NVIDIA_VISIBLE_DEVICES"),
            "nvidia_driver_capabilities": os.environ.get("NVIDIA_DRIVER_CAPABILITIES"),
        }

        if cli.get("ok") and smi_path:
            try:
                result = subprocess.run(
                    [smi_path, "--query-gpu=name,driver_version,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=8, check=False,
                )
                if result.returncode == 0 and result.stdout.strip():
                    parts = [part.strip() for part in result.stdout.strip().splitlines()[0].split(",")]
                    base.update({
                        "available": True,
                        "name": parts[0] if len(parts) > 0 else "NVIDIA GPU",
                        "driver": parts[1] if len(parts) > 1 else None,
                        "utilization_percent": int(float(parts[2])) if len(parts) > 2 else None,
                        "memory_used_mb": int(float(parts[3])) if len(parts) > 3 else None,
                        "memory_total_mb": int(float(parts[4])) if len(parts) > 4 else None,
                    })
                else:
                    base["reason"] = (result.stderr or "nvidia-smi query returned no GPU data").strip()
            except Exception as exc:
                base["reason"] = f"nvidia-smi query failed: {exc}"
        elif devices:
            base["name"] = "NVIDIA device node exposed (nvidia-smi unavailable)"
            base["reason"] = "GPU device nodes are visible, but nvidia-smi could not query the GPU. WebGL self-test is needed."
        else:
            base["reason"] = "No /dev/nvidia* device node and no working nvidia-smi command are visible inside this container. The Space may still be on CPU hardware, or the GPU runtime/image configuration may not be exposed."

        _gpu_cache = base
        _gpu_cache_at = now
        return dict(_gpu_cache)


def run_gpu_health_check() -> dict[str, Any]:
    """Run an actual Chromium WebGL renderer check and report container GPU diagnostics."""
    global _gpu_test_result
    if not _gpu_test_lock.acquire(blocking=False):
        return {"tested": True, "ok": False, "message": "GPU health check is already running."}
    started = time.time()
    result: dict[str, Any] = {"tested": True, "ok": False, "message": "GPU test started."}
    try:
        status = get_gpu_status(force=True)
        result["container_probe"] = status
        renderer = ""
        browser_error = None
        browser = None
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=chromium_launch_args(True) + ["--enable-logging=stderr"],
                )
                page = browser.new_page()
                renderer = page.evaluate("""() => {
                    const canvas = document.createElement('canvas');
                    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                    if (!gl) return 'WebGL unavailable';
                    const ext = gl.getExtension('WEBGL_debug_renderer_info');
                    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
                }""")
        except Exception as exc:
            browser_error = f"Chromium WebGL probe failed: {exc}"
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass

        hardware_webgl = bool(renderer) and bool(re.search(r"NVIDIA|Tesla|GeForce|Quadro|RTX", renderer, re.I)) and not bool(re.search(r"swiftshader|llvmpipe|software", renderer, re.I))
        result.update({
            "webgl_renderer": renderer or None,
            "hardware_webgl": hardware_webgl,
            "browser_error": browser_error,
            "ok": hardware_webgl,
            "elapsed_seconds": round(time.time() - started, 2),
        })
        if hardware_webgl:
            result["message"] = "PASS: Chromium WebGL is using NVIDIA hardware."
            log(f"GPU SELF-TEST PASS: WebGL renderer = {renderer}")
        else:
            result["message"] = "FAIL: Chromium did not confirm NVIDIA hardware WebGL. Check the Space hardware selection, runtime stage, Docker base image, and /dev/nvidia devices."
            log(f"GPU SELF-TEST FAIL: renderer={renderer or 'unavailable'}; {browser_error or status.get('reason', '')}", "WARN")
        _gpu_test_result = result
        return result
    except Exception as exc:
        result["message"] = f"GPU health check failed: {exc}"
        result["error"] = repr(exc)
        _gpu_test_result = result
        log(result["message"], "ERROR")
        return result
    finally:
        _gpu_test_lock.release()


def chromium_launch_args(use_gpu: bool) -> list[str]:
    base = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-video-encode"]
    if use_gpu:
        # Use available NVIDIA hardware for WebGL/rendering only.
        return base + ["--enable-gpu", "--enable-webgl", "--ignore-gpu-blocklist",
                       "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface"]
    # Software WebGL fallback. The page uses its normal built-in encoder path.
    return base + ["--enable-unsafe-swiftshader", "--use-gl=swiftshader", "--disable-gpu-sandbox"]


def webgl_is_hardware(page) -> bool:
    try:
        renderer = page.evaluate("""() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return ''; const e = gl.getExtension('WEBGL_debug_renderer_info'); return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); }""")
    except Exception:
        return False
    log(f"WebGL renderer: {renderer or 'none'}")
    return bool(renderer) and not re.search(r"swiftshader|llvmpipe|software", renderer, re.I)


def cloud_render_url(uid: str, job_id: str, secret: str) -> str:
    """Build the website's private render hash-route without exposing it in logs."""
    parts = urlsplit(SITE_URL)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if 1 <= CLOUD_RENDER_WORKERS <= 8:
        query["workers"] = str(CLOUD_RENDER_WORKERS)
    path = parts.path.rstrip("/") + "/"
    base = urlunsplit((parts.scheme, parts.netloc, path, urlencode(query), ""))
    return f"{base}#/cloudrender/{uid}/{job_id}/{secret}"


def _set_active(job_id: str, **values: Any) -> None:
    with _active_lock:
        row = _active_jobs.setdefault(job_id, {"job_id": job_id, "started_at": time.time()})
        row.update(values)
        row["updated_at"] = time.time()


def render_one(uid: str, job_id: str, job: dict[str, Any], slot: int = 0) -> None:
    secret = str(job.get("secret") or "")
    url = cloud_render_url(uid, job_id, secret)
    ref = db.reference(f"cloudExports/{uid}/{job_id}")
    deadline = time.time() + job_timeout_seconds(job)
    started = time.time()
    _set_active(job_id, source="hf", status="starting", phase="starting", progress=0.0, slot=slot)
    log(f"Starting render job {job_id} (slot {slot}); website/browser built-in video encoder selected.")
    browser = None
    try:
        with sync_playwright() as playwright:
            use_gpu = nvidia_gpu_available()
            log("NVIDIA GPU detected; WebGL/rendering acceleration enabled. Video encoding stays on the browser's own encoder." if use_gpu else "No NVIDIA GPU detected; using software WebGL. Video encoding remains on browser CPU path.")
            profile = os.path.join(PROFILE_DIR, f"slot-{slot}")
            try:
                browser = playwright.chromium.launch_persistent_context(
                    profile, headless=True, args=chromium_launch_args(use_gpu),
                    viewport={"width": 960, "height": 720},
                )
            except Exception:
                if not use_gpu:
                    raise
                log("NVIDIA Chromium launch failed; retrying with software WebGL.", "WARN")
                use_gpu = False
                browser = playwright.chromium.launch_persistent_context(
                    profile, headless=True, args=chromium_launch_args(False),
                    viewport={"width": 960, "height": 720},
                )
            page = browser.pages[0] if browser.pages else browser.new_page()
            if use_gpu and not webgl_is_hardware(page):
                log("Hardware WebGL not available in Chromium; retrying with software WebGL.", "WARN")
                browser.close()
                use_gpu = False
                browser = playwright.chromium.launch_persistent_context(
                    profile, headless=True, args=chromium_launch_args(False),
                    viewport={"width": 960, "height": 720},
                )
                page = browser.pages[0] if browser.pages else browser.new_page()
            page.on(
                "console",
                lambda message: log(f"[{job_id}] browser: {message.text[:350]}")
                if "dragonbones.com" not in message.text.lower() and not message.text.startswith("DragonBones:")
                else None,
            )
            page.on("pageerror", lambda error: log(f"[{job_id}] browser page error: {error}", "ERROR"))
            page.goto(url, wait_until="load", timeout=60_000)
            log(f"[{job_id}] render page opened; waiting for progress updates.")
            last_seen = None
            last_change = time.time()
            status = "pending"
            while time.time() < deadline:
                current = _get_queue_job(uid, job_id)
                status = str(current.get("status") or "pending")
                phase = str(current.get("phase") or status)
                try:
                    progress = float(current.get("progress") or 0)
                except (TypeError, ValueError):
                    progress = 0.0
                # The website normally stores progress as 0..1; tolerate 0..100 too.
                if progress > 1.0:
                    progress /= 100.0
                progress = max(0.0, min(1.0, progress))
                _set_active(job_id, status=status, phase=phase, progress=progress, elapsed_seconds=round(time.time() - started, 1))
                seen = (status, phase, round(progress, 3))
                if seen != last_seen:
                    last_seen, last_change = seen, time.time()
                    log(f"[{job_id}] {status} | {phase} | {progress:.0%}")
                elif time.time() - last_change > 120:
                    log(f"[{job_id}] no progress update for 2 minutes; last phase={phase}, progress={progress:.0%}", "WARN")
                    last_change = time.time()
                if status in TERMINAL:
                    break
                page.wait_for_timeout(POLL_SECONDS * 1000)
            if status not in TERMINAL:
                log(f"[{job_id}] render timed out after {job_timeout_seconds(job)} seconds.", "ERROR")
                ref.update({"status": "error", "error": "The render machine took too long and gave up.", "updatedAt": int(time.time() * 1000)})
                _set_active(job_id, status="error", phase="timeout", progress=0.0,
                    error=f"Render timed out after {job_timeout_seconds(job)} seconds.")
            else:
                _set_active(job_id, status=status, phase=status, progress=1.0 if status == "done" else _active_jobs.get(job_id, {}).get("progress", 0))
                log(f"[{job_id}] completed with status={status} in {time.time() - started:.1f}s.")
    except Exception:
        detail = traceback.format_exc()
        log(f"[{job_id}] render crashed:\n{detail}", "ERROR")
        try:
            ref.update({"status": "error", "error": "The render machine ran into an unexpected problem.", "updatedAt": int(time.time() * 1000)})
        except Exception:
            pass
        _set_active(job_id, status="error", phase="crashed", error=detail[-1000:])
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        # Keep terminal rows in dashboard briefly so the user can read the result.
        with _active_lock:
            if job_id in _active_jobs:
                _active_jobs[job_id]["finished_at"] = time.time()


CLEANUP_AFTER_SECONDS = 15 * 60
STALE_AFTER_SECONDS = 2 * 60 * 60
KAGGLE_ORPHAN_CLAIM_SECONDS = max(90, int(os.environ.get("KAGGLE_ORPHAN_CLAIM_SECONDS", "180")))


def cleanup_old_jobs(all_jobs: dict[str, Any], running: set[tuple[str, str]]) -> None:
    now_ms = int(time.time() * 1000)
    for uid, rows in all_jobs.items():
        if not isinstance(rows, dict):
            continue
        for job_id, job in rows.items():
            if not isinstance(job, dict):
                continue
            status = job.get("status")
            try:
                updated_ms = int(job.get("updatedAt") or job.get("createdAt") or now_ms)
            except (TypeError, ValueError, OverflowError):
                updated_ms = now_ms
            age_seconds = max(0.0, (now_ms - updated_ms) / 1000)
            ref = db.reference(f"cloudExports/{uid}/{job_id}")
            try:
                if status in TERMINAL and age_seconds > CLEANUP_AFTER_SECONDS:
                    ref.delete()
                    _remove_cached_job(str(uid), str(job_id))
                elif status == "rendering" and job.get("workerSource") == "kaggle" and (uid, job_id) not in running:
                    try:
                        claimed_at = int(job.get("workerClaimedAt") or job.get("updatedAt") or now_ms)
                    except (TypeError, ValueError):
                        claimed_at = now_ms
                    claim_age = max(0.0, (now_ms - claimed_at) / 1000)
                    worker_id = str(job.get("workerId") or "")
                    # A Space restart clears in-memory claims. If the worker does
                    # not reappear within the lease window, fail closed instead
                    # of leaving this job stuck in `rendering` for two hours.
                    if worker_id and _agent_is_online(worker_id):
                        # Space restarted but the Kaggle process survived. Restore
                        # its in-memory claim so the existing worker can continue
                        # polling status/log/complete without restarting the job.
                        with _kaggle_lock:
                            if job_id not in _kaggle_claims:
                                _kaggle_claims[job_id] = {
                                    "uid": str(uid), "agent_id": worker_id,
                                    "job": dict(job), "claimed_at": claimed_at / 1000.0,
                                }
                        try:
                            progress = float(job.get("progress") or 0)
                        except (TypeError, ValueError):
                            progress = 0.0
                        if progress > 1:
                            progress /= 100.0
                        _set_active(
                            str(job_id), source="kaggle", status="rendering",
                            phase=str(job.get("phase") or "rendering"),
                            progress=max(0.0, min(1.0, progress)),
                            started_at=claimed_at / 1000.0, agent_id=worker_id,
                        )
                    elif claim_age > KAGGLE_ORPHAN_CLAIM_SECONDS:
                        reason = "Kaggle worker disappeared after claiming this export (or the Space restarted). Check output, then retry."
                        updates = {"status": "error", "error": reason, "updatedAt": now_ms}
                        ref.update(updates)
                        _patch_cached_job(str(uid), str(job_id), updates)
                        log(f"Marking orphaned Kaggle job {job_id} as failed; worker={worker_id or 'unknown'}.", "WARN")
                elif status in ("pending", "rendering") and (uid, job_id) not in running and age_seconds > STALE_AFTER_SECONDS:
                    reason = "The render machine restarted while this job was in progress. Please try again."
                    updates = {"status": "error", "error": reason, "updatedAt": now_ms}
                    ref.update(updates)
                    _patch_cached_job(str(uid), str(job_id), updates)
                    log(f"Marking abandoned job {job_id} as failed (inactive for {age_seconds / 60:.0f} min).", "WARN")
            except Exception as exc:
                log(f"Could not clean up job {job_id}: {exc}", "ERROR")


_next_skip_logged = [0.0]
_router_user_stop = False          # the router was stopped on purpose through /api/stop: the watchdog leaves it alone
_listener_retry_at = 0.0


def _ensure_router() -> None:
    """Keep the router (the thread that starts Kaggle and hands out jobs) running. If its automatic start at boot did not happen (for
    example the Firebase listener needed longer than 35 s), requests would wait forever and Kaggle would never be started."""
    global _listener_retry_at
    if _router_user_stop or not _firebase_ready:
        return
    if os.environ.get("AUTO_START_ROUTER", "1").strip().lower() in {"0", "false", "no", "off"}:
        return
    if not _queue_ready.is_set():
        if time.time() >= _listener_retry_at:
            _listener_retry_at = time.time() + 60
            log("The Firebase listener is not ready yet: trying to start it again.", "WARN")
            threading.Thread(target=start_queue_listener, daemon=True, name="queue-listener-retry").start()
        return
    if _worker_thread and _worker_thread.is_alive():
        return
    ok, message = start_worker()
    log(("Router was not running: started it again. " if ok else "Router was not running and could not be started: ") + message, "WARN" if ok else "ERROR")


def _router_watchdog() -> None:
    while True:
        time.sleep(15)
        try:
            _ensure_router()
        except Exception as exc:
            log(f"Router watchdog error: {exc}", "ERROR")


@asynccontextmanager
async def lifespan(_: FastAPI):
    os.makedirs(PROFILE_DIR, exist_ok=True)
    firebase_ok = init_firebase()
    if firebase_ok:
        stream_ok = start_queue_listener()
        if stream_ok and os.environ.get("AUTO_START_ROUTER", "1").strip().lower() not in {"0", "false", "no", "off"}:
            ok, message = start_worker()
            if ok:
                log("Automatic router startup enabled. " + message)
            else:
                log("Automatic router startup could not start: " + message, "ERROR")
    threading.Thread(target=_router_watchdog, daemon=True, name="router-watchdog").start()
    gpu = get_gpu_status(force=True)
    if gpu.get("available"):
        log(f"Space GPU visible: {gpu.get('name')} | driver {gpu.get('driver') or 'not reported'} | browser built-in video encoder is used.")
    else:
        log(f"GPU probe not confirmed: {gpu.get('reason') or gpu.get('name')}. HF fallback can use software WebGL.", "WARN")
    yield
    stop_worker()
    stop_queue_listener()


app = FastAPI(title="12TOONS Render Router", lifespan=lifespan)
app.include_router(fleet_router)


def _agent_is_online(agent_name: str, now: float | None = None) -> bool:
    now = now or time.time()
    agent = _fleet_agents.get(agent_name)
    return bool(agent and now - agent.get("last_seen", 0) <= KAGGLE_STALE_AFTER_SECONDS)


def _restore_kaggle_claim(job_id: str) -> dict[str, Any] | None:
    """Rehydrate a worker claim from the local Firebase event cache after Space restart."""
    with _kaggle_lock:
        existing = _kaggle_claims.get(job_id)
    if existing:
        return existing

    snapshot = _get_queue_snapshot()
    for uid, rows in snapshot.items():
        if not isinstance(rows, dict):
            continue
        row = rows.get(str(job_id))
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "").lower() != "rendering" or row.get("workerSource") != "kaggle":
            continue
        agent_id = str(row.get("workerId") or "")
        if not agent_id or not _agent_is_online(agent_id):
            return None
        try:
            claimed_at = int(row.get("workerClaimedAt") or row.get("updatedAt") or int(time.time() * 1000))
        except (TypeError, ValueError, OverflowError):
            claimed_at = int(time.time() * 1000)
        candidate = {
            "uid": str(uid), "agent_id": agent_id,
            "job": dict(row), "claimed_at": claimed_at / 1000.0,
        }
        with _kaggle_lock:
            existing = _kaggle_claims.setdefault(str(job_id), candidate)
        try:
            progress = float(row.get("progress") or 0)
        except (TypeError, ValueError):
            progress = 0.0
        if progress > 1:
            progress /= 100.0
        _set_active(
            str(job_id), source="kaggle", status="rendering",
            phase=str(row.get("phase") or "rendering"),
            progress=max(0.0, min(1.0, progress)),
            started_at=claimed_at / 1000.0, agent_id=agent_id,
        )
        log(f"Restored Kaggle claim {job_id} from the Firebase event cache after Space restart.")
        return existing
    return None


def _any_kaggle_online() -> bool:
    now = time.time()
    selected = selected_account_number()
    if selected is None:
        return False
    selected_name = f"Kaggle {selected}"
    return any(
        str(agent.get("name") or "") == selected_name
        and now - agent.get("last_seen", 0) <= KAGGLE_STALE_AFTER_SECONDS
        for agent in _fleet_agents.values()
    )


def _expire_stale_kaggle_claims() -> None:
    """Mark jobs interrupted when their claiming Kaggle worker disappears."""
    now = time.time()
    stale: list[tuple[str, dict[str, Any]]] = []
    with _kaggle_lock:
        for job_id, claim in list(_kaggle_claims.items()):
            if not _agent_is_online(str(claim.get("agent_id") or ""), now):
                stale.append((job_id, _kaggle_claims.pop(job_id)))
    for job_id, claim in stale:
        try:
            current = _get_queue_job(str(claim["uid"]), job_id)
            status = str(current.get("status") or "pending").lower()
            if status not in TERMINAL:
                reason = f"{claim.get('agent_id') or 'Kaggle worker'} disconnected after claiming this export. Check the output, then retry if needed."
                updates = {"status": "error", "error": reason, "updatedAt": int(time.time() * 1000)}
                db.reference(f"cloudExports/{claim['uid']}/{job_id}").update(updates)
                _patch_cached_job(str(claim["uid"]), job_id, updates)
                _set_active(job_id, source="kaggle", status="error", phase="worker_disconnected", error=reason)
                log(f"Kaggle worker disconnected during job {job_id}; marked error to prevent duplicate rendering.", "ERROR")
        except Exception as exc:
            log(f"Could not recover stale Kaggle claim {job_id}: {exc}", "ERROR")


def _mark_start_failed(number: int) -> None:
    _kaggle_start_failed_accounts.add(number)
    _kaggle_start_failed_at[number] = time.time()


def _schedule_kaggle_accounts(pending_count: int, newest_request_ms: float = 0) -> bool:
    """Start only the selected Kaggle identity; let previous identities drain first."""
    now = time.time()
    if pending_count > 0:
        maybe_rotate("a job is waiting")          # skip an account that is out of free hours before starting anything on it
    selected = selected_account_number()
    if selected is None:
        return False
    selected_name = f"Kaggle {selected}"
    online_by_number: dict[int, dict[str, Any]] = {}
    draining = []
    for agent in _fleet_agents.values():
        name = str(agent.get("name") or "")
        match = re.fullmatch(r"Kaggle (\d+)", name)
        if not match or now - float(agent.get("last_seen") or 0) > KAGGLE_STALE_AFTER_SECONDS:
            continue
        number = int(match.group(1))
        if number == selected:
            online_by_number[number] = agent
        else:
            draining.append(number)
            _auto_suppressed_accounts.add(number)
            _stop_req.add(name)

    # Never overlap two Kaggle identities. The old worker finishes its active
    # render(s), acknowledges Stop on heartbeat, and exits before the new one starts.
    if draining:
        return True

    with _kaggle_lock:
        if selected in online_by_number:
            _kaggle_start_requested_at.pop(selected, None)
            _kaggle_start_failed_accounts.discard(selected)
            return False

        # A request newer than the last start attempt gets an attempt of its own, at once: an old attempt (its worker already exited, or it
        # failed) must not make the Space skip a request that has not had a try yet.
        newest_s = newest_request_ms / 1000.0
        if newest_s and selected not in _kaggle_start_inflight_accounts:
            old_try = _kaggle_start_requested_at.get(selected)
            if old_try is not None and newest_s > old_try + 1:
                _kaggle_start_requested_at.pop(selected, None)
            if selected in _kaggle_start_failed_accounts and newest_s > _kaggle_start_failed_at.get(selected, 0) + 1:
                _kaggle_start_failed_accounts.discard(selected)
        requested_at = _kaggle_start_requested_at.get(selected)
        if requested_at is not None:
            boot = _fleet_boot.get(selected_name, {})
            failed_stage = str(boot.get("stage") or "").lower() in {"failed", "worker exited"}
            fresh_failure = failed_stage and float(boot.get("ts") or 0) >= requested_at
            timed_out = now - requested_at >= KAGGLE_START_GRACE_SECONDS
            if fresh_failure or timed_out:
                _kaggle_start_requested_at.pop(selected, None)
                _mark_start_failed(selected)
                if timed_out and not fresh_failure:
                    log(f"Selected KAGGLE_{selected} did not report online within {KAGGLE_START_GRACE_SECONDS}s; HF fallback can take over.", "WARN")
                return False
            return True

        if selected in _kaggle_start_inflight_accounts:
            return True
        # A new request is a clear wish to render: an account stopped earlier by hand, or one whose last automatic start failed a while ago,
        # is started again for it (a stopped/failed account used to stay skipped until Start was pressed on the Fleet page).
        if selected in _auto_suppressed_accounts and newest_request_ms / 1000.0 > _suppressed_at.get(selected, 0):
            _auto_suppressed_accounts.discard(selected)
            log(f"A new request arrived after Stop: automatic start of KAGGLE_{selected} is on again.")
        if selected in _kaggle_start_failed_accounts and now - _kaggle_start_failed_at.get(selected, 0) >= KAGGLE_RETRY_AFTER_SECONDS:
            _kaggle_start_failed_accounts.discard(selected)
            log(f"Trying KAGGLE_{selected} again after {KAGGLE_RETRY_AFTER_SECONDS}s because requests are still waiting.")
        if selected in _kaggle_start_failed_accounts or selected in _auto_suppressed_accounts:
            if pending_count > 0 and now - _skip_logged_at.get(selected, 0) > 60:
                _skip_logged_at[selected] = now
                why = "its last automatic start failed" if selected in _kaggle_start_failed_accounts else "Stop was pressed for it"
                log(f"Not auto-starting KAGGLE_{selected} for the waiting request: {why}.", "WARN")
            return False
        if pending_count <= 0:
            return False
        _kaggle_start_requested_at[selected] = now
        _kaggle_start_inflight_accounts.add(selected)
        threading.Thread(
            target=_start_account_thread, args=(selected,), daemon=True,
            name=f"kaggle-autostart-{selected}",
        ).start()
        log(f"Auto-starting only selected Kaggle account KAGGLE_{selected}; other configured IDs remain unused.")
        return True


def _mark_pending_phase(phase: str) -> None:
    """Tell the website what is happening to requests that are still waiting (the owner's page shows this text). Cloud export jobs that
    have not been claimed yet get `phase`; it is replaced by the page's own phases as soon as a machine picks the job up."""
    try:
        now_ms = int(time.time() * 1000)
        for uid, rows in (_get_queue_snapshot() or {}).items():
            if not isinstance(rows, dict):
                continue
            for job_id, job in rows.items():
                if isinstance(job, dict) and job.get("status") == "pending" and job.get("phase") != phase:
                    updates = {"phase": phase, "updatedAt": now_ms}
                    db.reference(f"cloudExports/{uid}/{job_id}").update(updates)
                    _patch_cached_job(str(uid), str(job_id), updates)
    except Exception as exc:
        log(f"Could not tell the website that a machine is starting: {exc}", "WARN")


def _start_account_thread(account_number: int) -> None:
    """Thread target for account starts scheduled while holding the fleet lock."""
    try:
        result = start_kaggle_account(account_number, automatic=True)
        log(f"Automatic Kaggle start for KAGGLE_{account_number}: {result.get('note', 'request accepted')}.")
        if result.get("ok"):
            _mark_pending_phase("kernel_requested")          # Kaggle accepted the start request (the machine itself is not up yet)
        if not result.get("ok"):
            with _kaggle_lock:
                _mark_start_failed(account_number)
    except Exception as exc:
        with _kaggle_lock:
            _mark_start_failed(account_number)
        log(f"Automatic Kaggle start failed for KAGGLE_{account_number}: {exc}; HF fallback will be used if no Kaggle worker is online.", "ERROR")
    finally:
        with _kaggle_lock:
            _kaggle_start_inflight_accounts.discard(account_number)


def worker_loop() -> None:
    global _worker_state, _worker_error, _queue_count
    running: set[tuple[str, str]] = set()
    slots_in_use: set[int] = set()
    log("Render router started. Firebase change listener drives the queue; Kaggle auto-start is enabled." if AUTO_START_KAGGLE else "Render router started. Firebase change listener drives the queue.")
    try:
        while not _worker_stop.is_set():
            try:
                if not _queue_ready.is_set():
                    log("Waiting for Firebase cloudExports initial sync.", "WARN")
                    _wait_for_queue_change(POLL_SECONDS)
                    continue
                _expire_stale_kaggle_claims()
                all_jobs = _get_queue_snapshot()
                with _kaggle_lock:
                    remote_running = {(claim.get("uid"), jid) for jid, claim in _kaggle_claims.items()}
                cleanup_old_jobs(all_jobs, running | remote_running)
                pending_jobs: list[tuple[str, str, dict[str, Any]]] = []
                for uid, rows in all_jobs.items():
                    if not isinstance(rows, dict):
                        continue
                    for job_id, job in rows.items():
                        if isinstance(job, dict) and job.get("status") == "pending" and job.get("secret"):
                            pending_jobs.append((str(uid), str(job_id), job))
                _queue_count = len(pending_jobs)
                kaggle_online = _any_kaggle_online()
                if pending_jobs and AUTO_START_KAGGLE:
                    waiting_for_kaggle = _schedule_kaggle_accounts(len(pending_jobs), max((float(j.get('createdAt') or 0) for _, _, j in pending_jobs), default=0))
                else:
                    waiting_for_kaggle = False
                    if not pending_jobs:
                        with _kaggle_lock:
                            # Keep leases for calls still in flight; clearing them
                            # could schedule a duplicate push on the next queue burst.
                            for number in list(_kaggle_start_requested_at):
                                if number not in _kaggle_start_inflight_accounts:
                                    _kaggle_start_requested_at.pop(number, None)
                            _kaggle_start_failed_accounts.clear()

                for uid, job_id, job in pending_jobs:
                    key = (uid, job_id)
                    with _kaggle_lock:
                        has_kaggle_claim = job_id in _kaggle_claims
                    if kaggle_online or has_kaggle_claim or waiting_for_kaggle:
                        continue
                    if key in running or len(running) >= MAX_CONCURRENT:
                        continue
                    slot = next((i for i in range(MAX_CONCURRENT) if i not in slots_in_use), None)
                    if slot is None:
                        continue
                    claimed_row = _claim_pending_job(uid, job_id, "hf", f"HF slot {slot}")
                    if claimed_row is None:
                        continue
                    running.add(key)
                    slots_in_use.add(slot)
                    _set_active(job_id, source="hf", status="queued", phase="queued", progress=0.0, slot=slot)
                    job = claimed_row

                    def run_one(u=uid, jid=job_id, row=job, k=key, s=slot):
                        try:
                            render_one(u, jid, row, s)
                        finally:
                            running.discard(k)
                            slots_in_use.discard(s)
                    threading.Thread(target=run_one, daemon=True, name=f"render-{job_id[:8]}").start()
                with _state_lock:
                    if _worker_stop.is_set():
                        break
                    _worker_state = "running"
                _wait_for_queue_change(POLL_SECONDS)
            except Exception as exc:
                _worker_error = str(exc)
                log(f"Worker polling error: {exc}\n{traceback.format_exc()}", "ERROR")
                _wait_for_queue_change(POLL_SECONDS)
    finally:
        with _state_lock:
            _worker_state = "stopped"
        log("Render router stopped. Any already-running render tab is allowed to finish.")


def start_worker() -> tuple[bool, str]:
    global _worker_thread, _worker_state
    if not _firebase_ready:
        return False, "Firebase is not ready. Check the KEY_JSON Secret and Space logs."
    if not _queue_ready.is_set():
        detail = _queue_stream_error or "Firebase cloudExports listener has not completed its initial sync. Restart the Space after checking Firebase access."
        return False, detail
    with _state_lock:
        if _worker_thread and _worker_thread.is_alive():
            return True, "Worker is already running."
        _worker_stop.clear()
        _worker_state = "starting"
        _worker_thread = threading.Thread(target=worker_loop, daemon=True, name="12toons-render-worker")
        _worker_thread.start()
    log("Start button pressed; Firebase queue watcher is starting.")
    return True, "Worker started. Kaggle gets first priority; HF is the fallback."


def stop_worker() -> tuple[bool, str]:
    global _worker_state
    with _state_lock:
        if not _worker_thread or not _worker_thread.is_alive():
            _worker_state = "stopped"
            return True, "Worker is already stopped."
        _worker_state = "stopping"
        _worker_stop.set()
    log("Stop requested. No new jobs will be picked up; active renders are allowed to finish.", "WARN")
    return True, "Stop requested. Active render jobs will finish before the worker becomes idle."


@app.get("/api/fleet/queue")
def api_fleet_queue() -> dict[str, Any]:
    """What is being processed and what is waiting, for the dashboard. Job ids and times only: never the owner's id or the job secret."""
    now_ms = int(time.time() * 1000)
    processing: list[dict[str, Any]] = []
    queued: list[dict[str, Any]] = []
    for uid, rows in (_get_queue_snapshot() or {}).items():
        if not isinstance(rows, dict):
            continue
        for job_id, job in rows.items():
            if not isinstance(job, dict):
                continue
            status = str(job.get("status") or "")
            if status not in ("pending", "rendering"):
                continue
            try:
                created = int(job.get("createdAt") or 0)
                claimed = int(job.get("workerClaimedAt") or job.get("updatedAt") or created)
            except (TypeError, ValueError):
                created = claimed = now_ms
            settings = job.get("settings") if isinstance(job.get("settings"), dict) else {}
            base = {"job_id": str(job_id), "seconds": job.get("seconds"), "quality": settings.get("quality"), "fps": settings.get("fps"),
                    "created_at": created, "phase": job.get("phase")}
            if status == "pending":
                queued.append({**base, "waiting_s": max(0.0, (now_ms - created) / 1000.0)})
            else:
                try:
                    progress = float(job.get("progress") or 0)
                except (TypeError, ValueError):
                    progress = 0.0
                processing.append({**base, "progress": progress, "source": job.get("workerSource") or "hf", "worker": job.get("workerId"),
                                   "queued_s": max(0.0, (claimed - created) / 1000.0), "processing_s": max(0.0, (now_ms - claimed) / 1000.0), "claimed_at": claimed})
    queued.sort(key=lambda j: j["created_at"])
    processing.sort(key=lambda j: j["claimed_at"])
    return {"now": now_ms, "processing": processing, "queue": queued, "router": {"state": _worker_state, "error": _worker_error or _queue_stream_error, "listener_ready": _queue_ready.is_set(), "firebase_ready": _firebase_ready}}


def _pending_count() -> int:
    """How many requests are waiting for a machine (the worker keeps itself awake while there are some)."""
    try:
        return sum(1 for rows in (_get_queue_snapshot() or {}).values() if isinstance(rows, dict)
                   for job in rows.values() if isinstance(job, dict) and job.get("status") == "pending")
    except Exception:
        return 0


@app.get("/api/kaggle/next")
def api_kaggle_next(
    agent_id: str = Query(..., min_length=1, max_length=60),
    wait: int = Query(default=8, ge=0, le=20),
) -> dict[str, Any]:
    """Long-poll the in-memory Firebase event mirror; does not read cloudExports from Firebase."""
    selected = selected_account_number()
    # A worker that came up by itself (for example the kernel was run by hand on kaggle.com) while no other Kaggle worker is online is
    # accepted: its account becomes the selected one, instead of the worker being refused and idling on a quota it burns.
    match = re.fullmatch(r"Kaggle (\d+)", agent_id)
    if match and selected is not None and agent_id != f"Kaggle {selected}" and _agent_is_online(agent_id) \
            and int(match.group(1)) in _fleet_account_numbers() \
            and not any(_agent_is_online(str(a.get("name") or "")) for a in _fleet_agents.values() if str(a.get("name") or "") not in {agent_id, f"Kaggle {selected}"}) \
            and not _agent_is_online(f"Kaggle {selected}"):
        log(f"{agent_id} came online while Kaggle {selected} was selected and not running: selecting {agent_id}.")
        select_kaggle_account(int(match.group(1)))
        selected = selected_account_number()
    if selected is None or agent_id != f"Kaggle {selected}" or not _agent_is_online(agent_id):
        raise HTTPException(status_code=403, detail=f"This Kaggle worker is not the selected online account (selected: {('Kaggle ' + str(selected)) if selected is not None else 'none'}; this worker: {agent_id}; online: {_agent_is_online(agent_id)}).")
    _expire_stale_kaggle_claims()
    if _worker_state != "running":
        _ensure_router()          # a worker is here and asking: make sure the router is not the thing that is missing
    if _worker_state != "running":
        return {"job": None, "waiting": _pending_count(), "reason": "Render router is stopped. Start it from the Space dashboard."}

    deadline = time.time() + wait
    while True:
        with _kaggle_lock:
            current_for_agent = sum(1 for claim in _kaggle_claims.values() if claim.get("agent_id") == agent_id)
            agent = _fleet_agents.get(agent_id, {})
            try:
                parallel_limit = max(1, min(4, int(agent.get("parallel") or 4)))
            except (TypeError, ValueError):
                parallel_limit = 4
            claimed_ids = set(_kaggle_claims)
        if current_for_agent < parallel_limit:
            with _active_lock:
                active_hf_ids = {
                    job_id for job_id, row in _active_jobs.items()
                    if row.get("source") == "hf" and row.get("status") not in TERMINAL
                }
            all_jobs = _get_queue_snapshot()
            found = None
            skipped = {"no_secret": 0, "taken_by_hf": 0, "already_claimed": 0, "claim_refused": 0}
            for uid, rows in all_jobs.items():
                if not isinstance(rows, dict):
                    continue
                for job_id, job in rows.items():
                    if not isinstance(job, dict) or job.get("status") != "pending":
                        continue
                    if not job.get("secret"):
                        skipped["no_secret"] += 1
                        continue
                    if job_id in active_hf_ids:
                        skipped["taken_by_hf"] += 1
                        continue
                    if job_id in claimed_ids:
                        skipped["already_claimed"] += 1
                        continue
                    # A Firebase transaction is the final arbiter: the HF
                    # fallback and every Kaggle account can race on the local
                    # snapshot, but only one can change pending -> rendering.
                    claimed_row = _claim_pending_job(str(uid), str(job_id), "kaggle", agent_id)
                    if claimed_row is None:
                        skipped["claim_refused"] += 1
                        continue
                    with _kaggle_lock:
                        _kaggle_claims[job_id] = {
                            "uid": uid, "agent_id": agent_id, "job": dict(claimed_row), "claimed_at": time.time(),
                        }
                    found = {
                        "id": job_id,
                        "uid": uid,
                        "secret": str(claimed_row.get("secret") or ""),
                        "seconds": _safe_job_seconds(claimed_row),
                        "render_url": cloud_render_url(str(uid), str(job_id), str(claimed_row.get("secret") or "")),
                    }
                    _set_active(job_id, source="kaggle", status="assigned", phase="assigned",
                                progress=0.0, started_at=time.time(), agent_id=agent_id)
                    log(f"Assigned export {job_id} to {agent_id} from the local Firebase event cache.")
                    break
                if found:
                    return {"job": found}
            if any(skipped.values()) and time.time() - _next_skip_logged[0] > 30:
                _next_skip_logged[0] = time.time()
                log(f"{agent_id} is waiting and requests are pending, but none was handed out: {skipped}.", "WARN")
        if time.time() >= deadline:
            return {"job": None, "waiting": _pending_count()}
        _wait_for_queue_change(min(1.0, deadline - time.time()))
        if not _agent_is_online(agent_id):
            return {"job": None, "reason": "Kaggle heartbeat expired."}


@app.get("/api/kaggle/jobs/{job_id}/status")
def api_kaggle_job_status(job_id: str) -> dict[str, Any]:
    claim = _restore_kaggle_claim(job_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Kaggle job claim not found or expired.")
    if not _agent_is_online(str(claim.get("agent_id") or "")):
        raise HTTPException(status_code=410, detail="Kaggle worker heartbeat expired.")
    current = _get_queue_job(str(claim["uid"]), job_id)
    status = str(current.get("status") or "pending")
    phase = str(current.get("phase") or status)
    try:
        progress = float(current.get("progress") or 0)
    except (TypeError, ValueError):
        progress = 0.0
    if progress > 1:
        progress /= 100.0
    progress = max(0.0, min(1.0, progress))
    elapsed = round(time.time() - claim["claimed_at"], 1)
    _set_active(job_id, source="kaggle", status=status, phase=phase, progress=progress,
                elapsed_seconds=elapsed, error=current.get("error"), agent_id=claim.get("agent_id"))
    return {"job_id": job_id, "status": status, "phase": phase, "progress": progress,
            "elapsed_seconds": elapsed, "error": current.get("error"), "updated_at": current.get("updatedAt")}


@app.post("/api/kaggle/jobs/{job_id}/log")
def api_kaggle_job_log(job_id: str, payload: dict[str, Any] = Body(default={})) -> dict[str, bool]:
    claim = _restore_kaggle_claim(job_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Kaggle job claim not found.")
    level = str(payload.get("level") or "INFO").upper()
    log(f"[{claim.get('agent_id')} {job_id}] {str(payload.get('message') or '')[:1000]}",
        "ERROR" if level == "ERROR" else ("WARN" if level == "WARN" else "INFO"))
    return {"ok": True}


@app.post("/api/kaggle/jobs/{job_id}/complete")
def api_kaggle_job_complete(job_id: str, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    _restore_kaggle_claim(job_id)
    with _kaggle_lock:
        claim = _kaggle_claims.pop(job_id, None)
    if not claim:
        return {"ok": True, "released": False}
    status = str(payload.get("status") or "completed")
    error_text = str(payload.get("error") or "")[:3000]
    if status in {"error", "failed"}:
        reason = "Kaggle render worker failed: " + (error_text or "unknown error")
        try:
            updates = {"status": "error", "error": reason, "updatedAt": int(time.time() * 1000)}
            db.reference(f"cloudExports/{claim['uid']}/{job_id}").update(updates)
            _patch_cached_job(str(claim["uid"]), job_id, updates)
        except Exception as exc:
            log(f"Could not mark Kaggle job {job_id} as error: {exc}", "ERROR")
        _set_active(job_id, source="kaggle", status="error", phase="error", error=reason)
        log(f"Kaggle job {job_id} failed: {error_text[:700]}", "ERROR")
    else:
        with _active_lock:
            row = dict(_active_jobs.get(job_id, {}))
        final_status = row.get("status", "completed")
        _set_active(job_id, source="kaggle", status=final_status, phase=final_status,
                    progress=1.0 if final_status == "done" else row.get("progress", 0),
                    elapsed_seconds=row.get("elapsed_seconds"))
        log(f"Kaggle worker {claim.get('agent_id')} released export {job_id} (status={status}).")
    return {"ok": True, "released": True}


@app.get("/", response_class=HTMLResponse)
def dashboard() -> HTMLResponse:
    html = (Path(__file__).parent / "fleet.html").read_text(encoding="utf-8")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})

@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"server": "ok", "firebase_ready": _firebase_ready, "worker_state": _worker_state, "gpu": get_gpu_status(force=True), "gpu_test": _gpu_test_result}


@app.get("/api/status")
def api_status() -> dict[str, Any]:
    # Serve the last queue count observed by the worker loop. Do not read the
    # entire Firebase export tree on every browser refresh (that adds cost).
    with _active_lock:
        active = [dict(row) for row in _active_jobs.values()]
    active.sort(key=lambda row: row.get("started_at", 0), reverse=True)
    return {
        "firebase_ready": _firebase_ready,
        "queue_ready": _queue_ready.is_set(),
        "worker_state": _worker_state,
        "worker_error": _worker_error,
        "queue_count": _queue_count,
        "gpu": get_gpu_status(),
        "gpu_test": _gpu_test_result,
        "active_jobs": active[:20],
    }


@app.post("/api/gpu-test")
def api_gpu_test() -> dict[str, Any]:
    """Run an on-demand diagnostic using the same Chromium/WebGL path as rendering."""
    return run_gpu_health_check()


@app.get("/api/logs")
def api_logs(after: int = Query(default=0, ge=0)) -> dict[str, Any]:
    with _log_lock:
        rows = [row for row in _logs if row["id"] > after]
        latest = _log_id
    return {"logs": rows, "latest_id": latest}


@app.post("/api/worker/start")
def api_start() -> dict[str, Any]:
    global _router_user_stop
    _router_user_stop = False
    ok, message = start_worker()
    if not ok:
        raise HTTPException(status_code=503, detail=message)
    return {"ok": True, "message": message}


@app.post("/api/worker/stop")
def api_stop() -> dict[str, Any]:
    global _router_user_stop
    _router_user_stop = True
    ok, message = stop_worker()
    return {"ok": ok, "message": message}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
