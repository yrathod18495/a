"""Kaggle worker fleet controls and telemetry for the private 12TOONS Space."""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse

router = APIRouter()
_agents: dict[str, dict[str, Any]] = {}
_boot: dict[str, dict[str, Any]] = {}
_fleet_logs: deque[dict[str, Any]] = deque(maxlen=1200)
_fleet_log_id = 0
HISTORY = 60
OFFLINE_AFTER = 45
FORGET_AFTER = 3600
_status_cache: dict[int, tuple[float, str]] = {}
_selected_account_number: int | None = None
_status_cache_ttl = max(10, int(os.environ.get("KAGGLE_STATUS_CACHE_SECONDS", "45")))
_start_lock = threading.RLock()
_starting_accounts: set[int] = set()
_auto_suppressed_accounts: set[int] = set()
KAGGLE_SLUG = os.environ.get("KAGGLE_KERNEL_SLUG", "render-worker").strip() or "render-worker"
# Keep in sync with worker.py. These are code defaults, not Space Secrets.
KAGGLE_PARALLEL = 4
CPU_ONLY_CORE_THRESHOLD = 40
_stop_req: set[str] = set()


def _append_fleet_log(name: str, line: str, *, stage: str = "", job_id: str = "") -> None:
    global _fleet_log_id
    text = str(line).replace("\x00", "")[:1000]
    level = "ERROR" if re.search(r"\b(error|failed|failure|exception|traceback)\b", text, re.I) else (
        "WARN" if re.search(r"\b(warn|warning)\b", text, re.I) else "INFO"
    )
    _fleet_log_id += 1
    _fleet_logs.append({
        "id": _fleet_log_id,
        "time": time.strftime("%H:%M:%S"),
        "name": name[:60],
        "job_id": job_id[:100],
        "stage": stage[:60],
        "level": level,
        "message": text,
    })
    b = _boot.setdefault(name, {"stage": "", "ts": 0.0, "logs": deque(maxlen=300), "last_error": ""})
    b["ts"] = time.time()
    b["logs"].append(f"[{time.strftime('%H:%M:%S')}] {text}")
    if stage and stage not in {"job", "idle"}:
        b["stage"] = stage[:60]
    if level == "ERROR":
        b["last_error"] = text


@router.post("/api/fleet/report")
def report(p: dict[str, Any]) -> dict[str, bool]:
    aid = str(p.get("agent_id") or "unknown")[:60]
    now = time.time()
    a = _agents.setdefault(aid, {"first_seen": now, "hist": deque(maxlen=HISTORY)})
    safe_jobs = []
    for raw_job in (p.get("jobs") or [])[:4]:
        if not isinstance(raw_job, dict):
            continue
        try:
            job_progress = float(raw_job.get("progress") or 0)
        except (TypeError, ValueError):
            job_progress = 0.0
        if job_progress > 1:
            job_progress /= 100.0
        try:
            job_elapsed = max(0.0, float(raw_job.get("elapsed_seconds") or 0))
        except (TypeError, ValueError):
            job_elapsed = 0.0
        if job_elapsed != job_elapsed or job_elapsed == float("inf"):
            job_elapsed = 0.0
        safe_jobs.append({
            "job_id": str(raw_job.get("job_id") or "")[:100],
            "phase": str(raw_job.get("phase") or "working")[:80],
            "progress": max(0.0, min(1.0, job_progress)),
            "elapsed_seconds": job_elapsed,
            "webgl": str(raw_job.get("webgl") or "")[:120],
        })
    safe_jobs = [job for job in safe_jobs if job["job_id"]]
    try:
        parallel_limit = max(1, min(4, int(p.get("parallel") or 4)))
    except (TypeError, ValueError):
        parallel_limit = 4
    a.update(
        name=str(p.get("name") or aid)[:60], last_seen=now,
        gpu_name=p.get("gpu_name"), driver=p.get("driver"), webgl=str(p.get("webgl") or ""),
        cpu=p.get("cpu"), cores=p.get("cores"), ram_used=p.get("ram_used"), ram_total=p.get("ram_total"),
        gpu_util=p.get("gpu_util"), vram_used=p.get("vram_used"), vram_total=p.get("vram_total"),
        temp=p.get("temp"), power=p.get("power"),
        job=p.get("job"), phase=p.get("phase"), progress=p.get("progress"), jobs=safe_jobs,
        elapsed_seconds=p.get("elapsed_seconds"), parallel=parallel_limit,
        last_error=str(p.get("last_error") or "")[:500],
        done=p.get("done", 0), failed=p.get("failed", 0), last_took=p.get("last_took"),
    )
    a["hist"].append([round(now), p.get("cpu") or 0, p.get("gpu_util") or 0])
    for old in [k for k, v in _agents.items() if now - v["last_seen"] > FORGET_AFTER]:
        _agents.pop(old, None)
    stop = a["name"] in _stop_req or aid in _stop_req
    _stop_req.discard(a["name"])
    _stop_req.discard(aid)
    return {"ok": True, "stop": stop}


@router.get("/api/fleet/state")
def state() -> dict[str, Any]:
    now = time.time()
    out = []
    for aid, a in _agents.items():
        d = {k: v for k, v in a.items() if k != "hist"}
        d.update(id=aid, online=now - a["last_seen"] <= OFFLINE_AFTER,
                 age=round(now - a["last_seen"]), uptime=round(a["last_seen"] - a["first_seen"]),
                 hist=list(a["hist"]))
        boot = _boot.get(d["name"], {})
        d["boot_stage"] = boot.get("stage", "")
        d["boot_age"] = round(now - boot.get("ts", now)) if boot else None
        d["last_error"] = d.get("last_error") or boot.get("last_error", "")
        out.append(d)
    out.sort(key=lambda d: (not d["online"], d["name"].lower()))
    return {"now": now, "agents": out}


@router.get("/fleet", response_class=HTMLResponse)
def page() -> HTMLResponse:
    return HTMLResponse((Path(__file__).parent / "fleet.html").read_text(encoding="utf-8"),
                        headers={"Cache-Control": "no-store"})


# Kaggle credentials live in HF Space Secrets as full kaggle.json values.
# Only the selected account's JSON is parsed and passed to the Kaggle CLI.
def _account_numbers() -> list[int]:
    numbers = []
    for key in os.environ:
        match = re.fullmatch(r"KAGGLE_(\d+)", key)
        if match and int(match.group(1)) >= 1:
            numbers.append(int(match.group(1)))
    return sorted(set(numbers))


def selected_account_number() -> int | None:
    global _selected_account_number
    numbers = _account_numbers()
    if not numbers:
        _selected_account_number = None
    elif _selected_account_number not in numbers:
        _selected_account_number = numbers[0]
    return _selected_account_number


def _acct(n: int) -> dict[str, str]:
    if n not in _account_numbers():
        raise HTTPException(status_code=404, detail=f"Secret KAGGLE_{n} is not configured.")
    raw = os.environ.get(f"KAGGLE_{n}", "").strip()
    try:
        data = json.loads(raw)
        username = str(data["username"]).strip()
        api_key = str(data["key"]).strip()
        if not username or not api_key:
            raise ValueError("username/key is empty")
        return {"username": username, "key": api_key}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"KAGGLE_{n} must contain a valid full kaggle.json: {exc}")


def select_kaggle_account(n: int) -> dict[str, Any]:
    """Select exactly one Kaggle identity; signal any previous worker to drain and exit."""
    global _selected_account_number
    _acct(n)  # Validate only the selected credential; other secrets are not parsed.
    now = time.time()
    stop_requested = []
    with _start_lock:
        previous = _selected_account_number
        _selected_account_number = n
        _auto_suppressed_accounts.clear()
        _stop_req.discard(f"Kaggle {n}")
        for aid, agent in list(_agents.items()):
            match = re.fullmatch(r"Kaggle (\d+)", str(agent.get("name") or aid))
            if not match:
                continue
            other = int(match.group(1))
            if other == n:
                continue
            if now - float(agent.get("last_seen") or 0) <= OFFLINE_AFTER:
                _auto_suppressed_accounts.add(other)
                _stop_req.add(str(agent.get("name") or f"Kaggle {other}"))
                stop_requested.append(other)
        _status_cache.pop(n, None)
    if previous != n:
        _append_fleet_log(f"Kaggle {n}", f"Selected KAGGLE_{n}. Previous account(s) {stop_requested or 'none'} will finish active jobs and stop before this account starts.", stage="selected")
    return {"selected": n, "draining_accounts": sorted(stop_requested)}


def _kaggle(account: dict[str, str], *args: str, cwd: str | None = None,
            timeout: int = 90) -> tuple[int, str]:
    config_dir = tempfile.mkdtemp(prefix="kg_")
    env = {
        **os.environ,
        "KAGGLE_USERNAME": account["username"],
        "KAGGLE_KEY": account["key"],
        "KAGGLE_CONFIG_DIR": config_dir,
    }
    try:
        result = subprocess.run(["kaggle", *args], capture_output=True, text=True,
                                timeout=timeout, env=env, cwd=cwd)
        return result.returncode, ((result.stdout or "") + (result.stderr or "")).strip()
    except FileNotFoundError:
        return 127, "Kaggle CLI is not installed in the Space; add kaggle to requirements.txt and rebuild."
    except subprocess.TimeoutExpired:
        return 124, "Kaggle command timed out."
    finally:
        shutil.rmtree(config_dir, ignore_errors=True)


def _kstatus(account: dict[str, str]) -> str:
    code, output = _kaggle(account, "kernels", "status", f"{account['username']}/{KAGGLE_SLUG}", timeout=40)
    if code != 0:
        return "not_started" if re.search(r"404|not found|does not exist", output, re.I) else "error"
    match = re.search(r'status\s+"?(?:KernelWorkerStatus\.)?([A-Za-z_]+)"?', output)
    return (match.group(1) if match else output[:60]).lower()


def _cached_kstatus(n: int, account: dict[str, str]) -> str:
    now = time.time()
    cached = _status_cache.get(n)
    if cached and now - cached[0] < _status_cache_ttl:
        return cached[1]
    status = _kstatus(account)
    _status_cache[n] = (now, status)
    return status


def _space_url() -> str:
    configured = os.environ.get("FLEET_SPACE_URL", "").strip()
    if configured:
        return configured.rstrip("/")
    host = os.environ.get("SPACE_HOST", "").strip().strip("/")
    return f"https://{host}" if host else ""


BOOT_TMPL = r'''import base64, json, os, subprocess, sys, time, urllib.request
os.environ.update(__ENV__)
URL = os.environ["HF_SPACE_URL"].rstrip("/"); NAME = os.environ["ACCOUNT_NAME"]
def post(lines, stage=None):
    for line in lines:
        print(str(line), flush=True)
    try:
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["HF_ACCESS_TOKEN"]}
        payload = {"name": NAME, "lines": lines, "stage": stage}
        request = urllib.request.Request(URL + "/api/fleet/log", json.dumps(payload).encode(), headers)
        urllib.request.urlopen(request, timeout=8).read()
    except Exception as exc:
        print("[LOG-POST-FAILED]", str(exc), flush=True)
def sh(label, *command, ok=True):
    post([label + " ..."], label)
    try:
        process = subprocess.Popen(list(command), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, bufsize=1)
    except Exception as exc:
        post([label + " could not start: " + repr(exc)], "failed")
        if ok: raise SystemExit(1)
        return 1
    buffer = []; last = time.time()
    for line in process.stdout:
        print(line, end="", flush=True); buffer.append(line.rstrip()[:300])
        if len(buffer) >= 15 or time.time() - last > 5:
            post(buffer[-15:]); buffer, last = [], time.time()
    process.wait()
    if buffer: post(buffer[-15:])
    post([label + ": exit " + str(process.returncode)])
    if ok and process.returncode:
        post(["FAILED at: " + label + " (worker not started)"], "failed")
        raise SystemExit(process.returncode or 1)
    return process.returncode

post(["Kaggle kernel booting; Python " + sys.version.split()[0]], "booting")
try:
    urllib.request.urlopen("https://pypi.org/simple/", timeout=12).read(64)
except Exception as exc:
    message = "INTERNET IS OFF or outbound access is blocked. In Kaggle: Notebook settings > Internet > On, then restart this kernel. Details: " + str(exc)
    post([message], "failed")
    raise SystemExit(2)

cpu_cores = os.cpu_count() or 1
use_gpu = cpu_cores <= 40
if use_gpu:
    sh("GPU check", "bash", "-lc", "if command -v nvidia-smi >/dev/null 2>&1; then nvidia-smi || echo 'nvidia-smi query failed; worker will continue with CPU/software rendering'; else echo 'nvidia-smi not found; worker will continue with CPU/software rendering'; fi", ok=False)
else:
    post([f"Detected {cpu_cores} logical CPU cores (more-than-40 threshold); selecting CPU-only rendering. nvidia-smi will not be called."], "cpu mode")
sh("apt packages", "bash", "-lc", "apt-get update -qq && apt-get install -y -qq libvulkan1 libegl1 libgl1 libgles2 xvfb", ok=False)
sh("pip install", sys.executable, "-m", "pip", "install", "-q", "playwright", "requests", "psutil", "websockets")
sh("chromium install", sys.executable, "-m", "playwright", "install", "--with-deps", "chromium")
open("/kaggle/working/worker.py", "wb").write(base64.b64decode(__WORKER__))
open("/kaggle/working/gpu_encode.py", "wb").write(base64.b64decode(__GPUENC__))
post(["Starting Kaggle worker; it will report CPU/GPU metrics and job progress."], "starting worker")
rc = sh("worker", sys.executable, "-u", "/kaggle/working/worker.py", ok=False)
post(["Worker exited with code " + str(rc)], "worker exited" if rc == 0 else "failed")
'''


def _bootstrap(n: int) -> str:
    worker_path = Path(__file__).parent / "worker.py"
    if not worker_path.exists():
        raise HTTPException(status_code=500, detail="worker.py is missing from the Space build.")
    worker = worker_path.read_bytes()
    gpuenc_path = Path(__file__).parent / "gpu_encode.py"
    gpuenc = gpuenc_path.read_bytes() if gpuenc_path.exists() else b""      # optional: without it the browser's own encoder is used
    hf_token = os.environ.get("HF_ACCESS_TOKEN", "").strip()
    if not hf_token:
        raise HTTPException(
            status_code=503,
            detail="HF_ACCESS_TOKEN Secret (READ access) is required because this Space is private.",
        )
    space_url = _space_url()
    if not space_url.startswith("https://"):
        raise HTTPException(
            status_code=503,
            detail="Could not determine this Space URL. Set FLEET_SPACE_URL=https://<your-space>.hf.space or ensure SPACE_HOST is available.",
        )
    env = {
        "HF_SPACE_URL": space_url,
        "HF_ACCESS_TOKEN": hf_token,
        "ACCOUNT_NAME": f"Kaggle {n}",
    }
    return BOOT_TMPL.replace("__ENV__", json.dumps(env)).replace(
        "__WORKER__", json.dumps(base64.b64encode(worker).decode())
    ).replace("__GPUENC__", json.dumps(base64.b64encode(gpuenc).decode()))


@router.post("/api/fleet/log")
def boot_log(p: dict[str, Any]) -> dict[str, bool]:
    name = str(p.get("name") or "unknown")[:60]
    stage = str(p.get("stage") or "")[:60]
    if stage == "booting":
        _boot[name] = {"stage": "booting", "ts": time.time(), "logs": deque(maxlen=300), "last_error": ""}
    for line in (p.get("lines") or [])[:30]:
        _append_fleet_log(name, str(line)[:1000], stage=stage, job_id=str(p.get("job_id") or ""))
    if stage and not (p.get("lines") or []):
        b = _boot.setdefault(name, {"stage": "", "ts": 0.0, "logs": deque(maxlen=300), "last_error": ""})
        b["stage"], b["ts"] = stage, time.time()
    return {"ok": True}


@router.get("/api/fleet/boot")
def boot_state() -> dict[str, Any]:
    now = time.time()
    return {"boot": [{"name": name, "stage": data["stage"], "age": round(now - data["ts"]),
                       "last_error": data.get("last_error", ""), "logs": list(data["logs"])[-120:]}
                      for name, data in sorted(_boot.items())]}


@router.get("/api/fleet/logs")
def fleet_logs(after: int = Query(default=0, ge=0), limit: int = Query(default=500, ge=1, le=1200)) -> dict[str, Any]:
    rows = [row for row in _fleet_logs if row["id"] > after]
    return {"logs": rows[-limit:], "latest_id": _fleet_log_id}


@router.get("/api/fleet/summary")
def summary() -> dict[str, Any]:
    """Public-safe selected-account status/progress only; never returns credentials/logs."""
    now = time.time()
    selected = selected_account_number()
    workers = []
    for agent in _agents.values():
        name = str(agent.get("name") or "")
        if selected is not None and name != f"Kaggle {selected}":
            continue
        workers.append({
            "name": name,
            "online": now - agent["last_seen"] <= OFFLINE_AFTER,
            "job": agent.get("job"), "phase": agent.get("phase"),
            "progress": agent.get("progress") or 0,
            "elapsed_seconds": agent.get("elapsed_seconds"),
            "jobs": [
                {"job_id": job.get("job_id"), "phase": job.get("phase"),
                 "progress": job.get("progress", 0), "elapsed_seconds": job.get("elapsed_seconds", 0)}
                for job in (agent.get("jobs") or [])[:4]
            ],
            "done": agent.get("done", 0), "failed": agent.get("failed", 0),
        })
    return {"selected": selected, "workers": workers}


@router.get("/api/fleet/kaggle")
def kaggle_list() -> dict[str, Any]:
    """List configured slot names; query Kaggle only for the one selected identity."""
    now = time.time()
    selected = selected_account_number()
    rows = []
    for n in _account_numbers():
        name = f"Kaggle {n}"
        boot = _boot.get(name, {})
        agent = next((a for a in _agents.values() if a.get("name") == name), None)
        online = bool(agent and now - agent.get("last_seen", 0) <= OFFLINE_AFTER)
        is_selected = n == selected
        username = None
        if is_selected:
            try:
                account = _acct(n)
                username = account.get("username")
                status = "running" if online else _cached_kstatus(n, account)
            except HTTPException:
                status = "bad_secret"
        else:
            status = "draining" if online else "not_selected"
        if online and is_selected:
            status = "running"
        rows.append({
            "n": n, "name": name, "username": username, "status": status,
            "selected": is_selected, "stage": boot.get("stage", ""),
            "last_error": (agent or {}).get("last_error") or boot.get("last_error", ""),
            "online": online, "auto_start": is_selected and n not in _auto_suppressed_accounts,
        })
    return {"selected": selected, "accounts": rows}


@router.post("/api/fleet/kaggle/{n}/select")
def kaggle_select(n: int) -> dict[str, Any]:
    return select_kaggle_account(n)


def start_kaggle_account(n: int, *, automatic: bool = False) -> dict[str, Any]:
    """Push one selected Kaggle identity. Never start two configured identities together."""
    if not automatic:
        select_kaggle_account(n)
    if selected_account_number() != n:
        return {"ok": False, "note": f"KAGGLE_{n} is not the selected account."}
    account = _acct(n)
    name = f"Kaggle {n}"
    now = time.time()
    other_online = [
        str(a.get("name")) for a in _agents.values()
        if str(a.get("name") or "") != name and now - float(a.get("last_seen") or 0) <= OFFLINE_AFTER
    ]
    if other_online:
        raise HTTPException(status_code=409, detail="Previous Kaggle worker is still finishing its active job(s). Wait until it is offline before starting the selected account.")
    with _start_lock:
        if n in _starting_accounts:
            return {"ok": True, "note": "Kaggle kernel start is already in progress.", "status": "booting"}
        if automatic and n in _auto_suppressed_accounts:
            return {"ok": False, "note": "Automatic start disabled for this account."}
        if not automatic:
            _auto_suppressed_accounts.discard(n)
        agent = next((a for a in _agents.values() if a.get("name") == name and time.time() - a.get("last_seen", 0) <= OFFLINE_AFTER), None)
        if agent:
            return {"ok": True, "note": "Kaggle worker is already online.", "status": "running"}
        status = _kstatus(account)
        _status_cache[n] = (time.time(), status)
        if status in {"running", "queued", "initializing", "compiling"}:
            # Reset an old failed boot marker when Kaggle confirms that this
            # kernel is active again; otherwise the router would skip the
            # startup grace period and send pending work to HF immediately.
            _boot[name] = {"stage": "booting", "ts": time.time(),
                           "logs": deque(maxlen=300), "last_error": ""}
            _append_fleet_log(name, f"Kaggle kernel is already {status}; waiting for worker heartbeat.", stage="booting")
            return {"ok": True, "note": f"Kaggle kernel is already {status}; waiting for worker heartbeat.", "status": status}
        _starting_accounts.add(n)
    try:
        _append_fleet_log(name, "Submitting Kaggle kernel push…", stage="pushing")
        build_dir = tempfile.mkdtemp(prefix="kern_")
        try:
            Path(build_dir, "worker_boot.py").write_text(_bootstrap(n), encoding="utf-8")
            # Prefer GPU unless this account previously reported an unusual more-than-40
            # logical-core CPU host. On a first launch we have no probe yet, so
            # request GPU; the worker itself will still bypass GPU at runtime
            # if it detects more than 40 cores.
            previous = next((a for a in _agents.values() if a.get("name") == name and a.get("cores") is not None), None)
            try:
                previous_cores = int(previous.get("cores")) if previous else 0
            except (TypeError, ValueError):
                previous_cores = 0
            enable_gpu = previous_cores <= CPU_ONLY_CORE_THRESHOLD
            Path(build_dir, "kernel-metadata.json").write_text(json.dumps({
                "id": f"{account['username']}/{KAGGLE_SLUG}",
                "title": KAGGLE_SLUG,
                "code_file": "worker_boot.py",
                "language": "python",
                "kernel_type": "script",
                "is_private": True,
                "enable_gpu": enable_gpu,
                "enable_internet": True,
                "dataset_sources": [],
                "competition_sources": [],
                "kernel_sources": [],
            }, indent=2), encoding="utf-8")
            code, output = _kaggle(account, "kernels", "push", "-p", build_dir, timeout=150)
        finally:
            shutil.rmtree(build_dir, ignore_errors=True)
        if code != 0:
            _append_fleet_log(name, "Kaggle push failed: " + (output[-800:] or "unknown error"), stage="failed")
            raise HTTPException(status_code=502, detail=output[-800:] or "Kaggle kernel push failed.")
        _status_cache[n] = (time.time(), "queued")
        _append_fleet_log(name, "Kernel push accepted. Kaggle is booting the worker.", stage="pushed")
        return {"ok": True, "note": output[-400:] or "Kernel pushed; Kaggle is starting it.", "status": "pushed"}
    except Exception as exc:
        boot = _boot.get(name, {})
        if boot.get("stage") != "failed":
            _append_fleet_log(name, f"Kaggle start failed: {type(exc).__name__}: {exc}", stage="failed")
        raise
    finally:
        with _start_lock:
            _starting_accounts.discard(n)


@router.post("/api/fleet/kaggle/{n}/start")
def kaggle_start(n: int) -> dict[str, Any]:
    return start_kaggle_account(n, automatic=False)


@router.post("/api/fleet/kaggle/{n}/stop")
def kaggle_stop(n: int) -> dict[str, bool]:
    if n not in _account_numbers():
        raise HTTPException(status_code=404, detail=f"KAGGLE_{n} is not configured.")
    if n != selected_account_number():
        raise HTTPException(status_code=409, detail="Select this Kaggle account before stopping it.")
    _auto_suppressed_accounts.add(n)
    _stop_req.add(f"Kaggle {n}")
    _append_fleet_log(f"Kaggle {n}", "Stop requested; worker will finish active jobs and exit. New jobs will not auto-start this account until Start is pressed.", stage="stop requested")
    return {"ok": True}


@router.get("/api/fleet/kaggle/{n}/output")
def kaggle_output(n: int) -> dict[str, Any]:
    """Return output only for the currently selected Kaggle identity."""
    if n != selected_account_number():
        raise HTTPException(status_code=409, detail="Select this account first; only the selected Kaggle identity is queried.")
    account = _acct(n)
    status = _cached_kstatus(n, account)
    target = f"{account['username']}/{KAGGLE_SLUG}"
    output_dir = tempfile.mkdtemp(prefix="kgout_")
    lines: list[str] = [f"Kernel status: {status}"]
    try:
        code, cli_output = _kaggle(account, "kernels", "output", target, "-p", output_dir, timeout=90)
        if cli_output:
            lines.append("Kaggle kernels output: " + cli_output[-4000:])
        files = sorted(Path(output_dir).rglob("*"))
        for path in files:
            if not path.is_file():
                continue
            if path.suffix.lower() == ".zip":
                try:
                    with zipfile.ZipFile(path) as archive:
                        for item in archive.infolist():
                            if item.file_size > 1_000_000 or not item.filename.lower().endswith((".txt", ".log", ".json", ".csv")):
                                continue
                            with archive.open(item) as stream:
                                data = stream.read(1_000_000).decode("utf-8", errors="replace")
                            lines.extend([f"--- {path.name}:{item.filename} ---", *data.splitlines()[-120:]])
                except Exception as exc:
                    lines.append(f"Could not inspect {path.name}: {exc}")
            elif path.suffix.lower() in {".txt", ".log", ".json", ".csv"}:
                try:
                    lines.extend([f"--- {path.name} ---", *path.read_text(encoding="utf-8", errors="replace").splitlines()[-120:]])
                except Exception:
                    continue
        if code != 0 and len(lines) == 1:
            lines.append("Kaggle kernels output failed: " + (cli_output or f"exit code {code}"))
        if len(lines) == 1:
            lines.append("No saved text output files are available yet. Live boot/job logs are in the Fleet Live Worker Logs panel.")
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)
    return {"name": f"Kaggle {n}", "status": status, "output": "\n".join(lines)[-18000:]}


@router.get("/api/fleet/health", response_class=PlainTextResponse)
def health_report() -> PlainTextResponse:
    now = time.time()
    lines = ["12TOONS Kaggle Fleet Health Report", f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}", ""]
    lines.append("KAGGLE ACCOUNTS")
    numbers = _account_numbers()
    selected = selected_account_number()
    if not numbers:
        lines.append("No KAGGLE_n secrets configured.")
    for n in numbers:
        name = f"Kaggle {n}"
        boot = _boot.get(name, {})
        agent = next((a for a in _agents.values() if a.get("name") == name), None)
        online = bool(agent and now - agent["last_seen"] <= OFFLINE_AFTER)
        if n != selected:
            status = "draining" if online else "not selected (credentials not loaded)"
        else:
            try:
                status = "running" if online else _cached_kstatus(n, _acct(n))
            except HTTPException:
                status = "bad_secret"
        lines.append(f"{name}: status={status}; selected={n == selected}; stage={boot.get('stage') or '-'}; last_update={boot.get('ts') or '-'}")
    lines.extend(["", "WORKER METRICS (CPU / GPU)"])
    if not _agents:
        lines.append("No worker telemetry received yet.")
    for agent in sorted(_agents.values(), key=lambda item: item.get("name", "")):
        online = now - agent["last_seen"] <= OFFLINE_AFTER
        lines.append(
            f"{agent.get('name')}: {'ONLINE' if online else 'OFFLINE'}; "
            f"CPU={agent.get('cpu')}%; cores={agent.get('cores')}; "
            f"GPU={agent.get('gpu_name') or 'CPU-only/not detected'}; GPU util={agent.get('gpu_util')}%; "
            f"VRAM={agent.get('vram_used')}/{agent.get('vram_total')} MB; "
            f"RAM={agent.get('ram_used')}/{agent.get('ram_total')} GB; "
            f"active_jobs={len(agent.get('jobs') or ([agent.get('job')] if agent.get('job') else []))}; "
            f"aggregate_phase={agent.get('phase') or '-'}; "
            f"aggregate_progress={round(float(agent.get('progress') or 0) * 100)}%; elapsed={agent.get('elapsed_seconds') or 0}s"
        )
        for job in (agent.get("jobs") or [])[:4]:
            lines.append(
                f"  job={job.get('job_id')}; phase={job.get('phase')}; "
                f"progress={round(float(job.get('progress') or 0) * 100)}%; "
                f"elapsed={job.get('elapsed_seconds') or 0}s"
            )
    lines.extend(["", "LAST ERRORS"])
    errors = []
    for name, boot in _boot.items():
        if boot.get("last_error"):
            errors.append(f"{name}: {boot['last_error']}")
    for agent in _agents.values():
        if agent.get("last_error"):
            errors.append(f"{agent.get('name')}: {agent['last_error']}")
    lines.extend(errors or ["No worker errors recorded."])
    lines.extend(["", "LAST 50 LOG LINES"])
    for row in list(_fleet_logs)[-50:]:
        prefix = f"[{row['time']}] [{row['level']}] [{row['name']}]"
        if row.get("job_id"):
            prefix += f" [{row['job_id']}]"
        lines.append(prefix + " " + row["message"])
    return PlainTextResponse("\n".join(lines))
