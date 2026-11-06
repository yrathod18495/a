"""
12toons Cloud Export worker.

What this is: a FastAPI app whose only real job runs in a background thread — it watches the Realtime Database for cloud-export
jobs the website created (api/export.js, action "cloudCreate") and opens each one in a headless Chromium tab pointed at a private
render link on the website itself (#/cloudrender/<uid>/<jobId>/<secret>). That page is part of the normal 12toons code: it loads
the project, renders the video with the exact same code a real export uses, uploads it to R2 and marks the job done — all over
HTTP calls the page makes itself. This worker never touches the video, the project data, or Cloudflare R2 at all; it only:
  1. finds jobs with status "pending",
  2. opens a browser tab at the render link and waits for the job to reach a finished state,
  3. closes the page and moves on (or kills the page early if the owner cancelled the job).

Secrets this Space needs (Settings -> Variables and secrets -> add as "Secret", not "Variable"):
  FIREBASE_SERVICE_ACCOUNT_KEY   the SAME service account JSON already used by the website's Vercel deployment
                                  (the value of FIREBASE_ADMIN_CREDENTIALS there) — needed to read job status.
  FIREBASE_DATABASE_URL          the SAME Realtime Database URL already used by the website (FIREBASE_DATABASE_URL on Vercel).
  SITE_URL                       the deployed website's base URL, e.g. https://a-two-roan-17.vercel.app (no trailing slash).
  HQ_ACCESS_KEY                  (optional) a password of your choosing; visiting this Space's root URL with ?key=<that password>
                                  shows a tiny status page. Leave it unset to leave that page closed to everyone.
  MAX_CONCURRENT                 (optional) how many videos to render at once; default 1. This machine has no real GPU, so
                                  WebGL is rendered in software — much slower than a real phone/computer — and raising this
                                  only helps if the Space has real CPU headroom to spare (see docs/CLOUD-EXPORT.md).

See ../docs/CLOUD-EXPORT.md for how to create this Space, what to put in each secret, and how to test the whole pipeline once.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import firebase_admin
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from firebase_admin import credentials, db
from playwright.sync_api import sync_playwright

SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
PROFILE_DIR = os.environ.get("PROFILE_DIR", "/tmp/12toons-render-profile")
# Optional cloud-render page override for controlled benchmarking (1–8).
# Default 0 lets the website choose workers from detected GPU + logical CPUs.
CLOUD_RENDER_WORKERS = int(os.environ.get("CLOUD_RENDER_WORKERS", "0"))
POLL_SECONDS = 4          # how often this worker checks the database for new jobs
# A Hugging Face Space's free/basic CPU tier has no real GPU, so Chromium renders WebGL in software (SwiftShader) — many times
# slower than on a real phone or computer, and that slowdown gets WORSE the more renders share the same CPU at once. Running
# jobs one at a time (instead of 2+ in parallel) keeps each one as fast as the machine allows, instead of several of them
# fighting over the same CPU and each taking far longer, which is what made a 77 s video alone take over 9 minutes and still
# time out. Raise this only on a Space with real CPU/GPU headroom to spare — see docs/CLOUD-EXPORT.md.
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
TERMINAL = {"done", "error", "cancelled"}


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def init_firebase():
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
    db_url = os.environ.get("FIREBASE_DATABASE_URL")
    if not sa_json or not db_url:
        log("FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_DATABASE_URL is missing — the worker cannot start.")
        return False
    try:
        cred = credentials.Certificate(json.loads(sa_json))
        firebase_admin.initialize_app(cred, {"databaseURL": db_url})
        log("Firebase ready.")
        return True
    except Exception:
        log("Firebase init failed:\n" + traceback.format_exc())
        return False


def job_timeout_seconds(job):
    # a generous ceiling so a stuck render does not tie up this worker forever: the video's own length, generously padded, plus a
    # fixed floor. The multiplier is large on purpose — software-rendered WebGL (see MAX_CONCURRENT above) can easily take 10-20x
    # real time on a CPU-only machine, especially at a high quality/fps the owner picked without knowing this machine has no GPU.
    seconds = float(job.get("seconds") or 30)
    return max(300, seconds * 20 + 180)


def nvidia_gpu_available():
    """Return True only when this machine exposes a working NVIDIA driver."""
    if not shutil.which("nvidia-smi"):
        return False
    try:
        result = subprocess.run(
            ["nvidia-smi", "-L"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        available = result.returncode == 0 and "GPU" in result.stdout
        if available:
            # Select the NVIDIA Vulkan ICD explicitly when the image exposes it.
            for icd in (
                "/usr/share/vulkan/icd.d/nvidia_icd.json",
                "/usr/share/vulkan/icd.d/nvidia_icd.x86_64.json",
                "/etc/vulkan/icd.d/nvidia_icd.json",
            ):
                if os.path.isfile(icd):
                    os.environ["VK_DRIVER_FILES"] = icd
                    os.environ["VK_ICD_FILENAMES"] = icd
                    break
            os.environ["__GLX_VENDOR_LIBRARY_NAME"] = "nvidia"
            runtime_dir = "/tmp/runtime-root"
            os.makedirs(runtime_dir, mode=0o700, exist_ok=True)
            os.environ["XDG_RUNTIME_DIR"] = runtime_dir
        return available
    except Exception:
        return False


def chromium_launch_args(use_gpu):
    # The render page (a public https site) must be allowed to open a WebSocket to the GPU encoder on this same machine (127.0.0.1). Newer Chrome blocks
    # that as a "local network access" request (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) unless these checks are switched off. Only ONE
    # --disable-features flag counts, so every feature to disable is listed in this single one.
    base = ["--no-sandbox", "--disable-dev-shm-usage",
            "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"]
    if use_gpu:
        # Use the machine's real NVIDIA WebGL stack (e.g. a T4) rather than
        # forcing SwiftShader. The render page separately selects parallel
        # frame workers based on its detected renderer and available CPUs.
        return base + [
            "--enable-gpu",
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--use-angle=vulkan",
            "--enable-features=Vulkan",
            "--disable-vulkan-surface",
        ]
    # CPU-only Spaces still need explicit software WebGL fallback.
    return base + [
        "--enable-unsafe-swiftshader",
        "--use-gl=swiftshader",
        "--disable-gpu-sandbox",
    ]


def gpu_encoder_job():
    """(encoder, port, token) for this job when GPU encoding is available, else None. Needs gpu_encode.py next to this file."""
    try:
        import gpu_encode
        enc = gpu_encode.get_encoder()
        if not enc:
            return None
        return enc, enc.port, enc.new_job()
    except Exception:
        log("GPU encoding is not available:\n" + traceback.format_exc())
        return None


def webgl_is_hardware(page):
    """True when this browser has a working WebGL that is not a software renderer (SwiftShader / llvmpipe)."""
    try:
        renderer = page.evaluate("""() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return ''; const e = gl.getExtension('WEBGL_debug_renderer_info'); return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); }""")
    except Exception:
        return False
    log(f"WebGL renderer: {renderer or 'none'}")
    return bool(renderer) and not re.search(r"swiftshader|llvmpipe|software", renderer, re.I)


def cloud_render_url(uid, job_id, secret, gpuenc=None):
    """Build a hash-route URL and preserve an optional ?workers=N query."""
    parts = urlsplit(SITE_URL)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if 1 <= CLOUD_RENDER_WORKERS <= 8:
        query["workers"] = str(CLOUD_RENDER_WORKERS)
    if gpuenc:
        query["gpuenc"] = gpuenc          # "<local port>.<one-time token>": tells the render page where to send frames for GPU encoding
    path = parts.path.rstrip("/") + "/"
    base = urlunsplit((parts.scheme, parts.netloc, path, urlencode(query), ""))
    return f"{base}#/cloudrender/{uid}/{job_id}/{secret}"


def render_one(uid, job_id, job, slot=0, helper=False):
    """Opens the render page for one job and waits for it to finish (or be cancelled), using the admin SDK the whole time — never
    the page's own state. Runs in its own thread so several jobs can render at once (MAX_CONCURRENT).

    helper=True: the job is already being rendered by another machine; this one only opens the same page, which then takes slices of the video
    from the shared list and hands them in. A helper never changes the job's state (it cannot fail it), it just leaves when its page says it is done."""
    secret = job.get("secret", "")
    helper_done = threading.Event()
    mode = {"helper": helper}          # a machine that opened a queued job can turn out to be a helper (another machine became the leader first)
    gpu_job = None
    url = cloud_render_url(uid, job_id, secret)
    ref = db.reference(f"cloudExports/{uid}/{job_id}")
    deadline = time.time() + job_timeout_seconds(job)
    # The URL contains the per-job secret. Never print it in worker logs.
    log(f"{'Helping with' if helper else 'Rendering'} job {job_id} for {uid} (private render URL hidden)")
    try:
        with sync_playwright() as p:
            use_gpu = nvidia_gpu_available()
            log("NVIDIA GPU detected; enabling hardware WebGL." if use_gpu else "No NVIDIA GPU detected; using SwiftShader software WebGL.")
            # With an NVIDIA GPU the video is encoded by ffmpeg (NVENC) instead of the browser's CPU encoder, if gpu_encode.py can do it here.
            if use_gpu:
                gpu_job = gpu_encoder_job()
                if gpu_job:
                    url = cloud_render_url(uid, job_id, secret, f"{gpu_job[1]}.{gpu_job[2]}")
            # One persistent profile per render SLOT (0..MAX_CONCURRENT-1): concurrent Chromiums never share a directory, and the next
            # job in the same slot reuses its cache. (A new thread id per job would have left a new profile folder behind every time.)
            job_profile = os.path.join(PROFILE_DIR, f"slot-{slot}")
            browser_args = chromium_launch_args(use_gpu)
            try:
                browser = p.chromium.launch_persistent_context(
                    job_profile,
                    headless=True,
                    args=browser_args,
                    viewport={"width": 960, "height": 720},
                )
            except Exception:
                if not use_gpu:
                    raise
                log("NVIDIA browser launch failed; retrying with SwiftShader.")
                browser = p.chromium.launch_persistent_context(
                    job_profile,
                    headless=True,
                    args=chromium_launch_args(False),
                    viewport={"width": 960, "height": 720},
                )
            page = browser.pages[0] if browser.pages else browser.new_page()
            if use_gpu and not webgl_is_hardware(page):
                # nvidia-smi works but Chromium could not get hardware WebGL (no Vulkan/graphics driver in this container): a render on
                # a broken WebGL would just fail, so fall back to software rendering like a CPU-only Space.
                log("Hardware WebGL is not available in this browser; retrying with SwiftShader.")
                browser.close()
                use_gpu = False
                browser = p.chromium.launch_persistent_context(job_profile, headless=True, args=chromium_launch_args(False), viewport={"width": 960, "height": 720})
                page = browser.pages[0] if browser.pages else browser.new_page()
            def on_console(m):
                text = m.text
                if "dragonbones.com" in text.lower() or text.startswith("DragonBones:"):
                    return          # the DragonBones banner is printed by every worker: it only floods the log
                if "this machine is the helper" in text:
                    mode["helper"] = True
                if "Cloud export helper finished" in text or "Cloud export: helper stopped" in text or "the job ended while this machine" in text:
                    helper_done.set()
                log(f"[{job_id}] page: {text[:300]}")
            page.on("console", on_console)          # the DragonBones banner is printed by every worker: it only floods the log
            page.on("pageerror", lambda e: log(f"[{job_id}] page error: {e}"))
            page.goto(url, wait_until="load", timeout=60_000)
            status = "pending"
            last_seen, last_change = None, time.time()
            while time.time() < deadline:
                current = (ref.get() or {})
                status = current.get("status", "pending")
                seen = (current.get("phase"), round(float(current.get("progress") or 0), 2))
                if seen != last_seen:
                    last_seen, last_change = seen, time.time()
                    log(f"[{job_id}] phase={seen[0]} progress={seen[1]:.0%}")
                elif time.time() - last_change > 120:
                    log(f"[{job_id}] no progress for 2 min at phase={seen[0]} progress={seen[1]:.0%} (still waiting)")
                    last_change = time.time()
                if status in TERMINAL or (mode["helper"] and helper_done.is_set()):
                    break
                # page.wait_for_timeout (not time.sleep): a plain Python sleep blocks this thread without ever handing control
                # back to Playwright's own driver, so console/pageerror messages queued by the browser sat unprinted — sometimes
                # for the ENTIRE render — until the next real Playwright call (browser.close()) finally flushed them all at once.
                # This still waits the same POLL_SECONDS; it's purely so the logs above show up while the render is happening.
                page.wait_for_timeout(POLL_SECONDS * 1000)
            if mode["helper"]:
                log(f"{job_id}: this machine's help is finished")
            elif status not in TERMINAL:
                log(f"{job_id} timed out after {job_timeout_seconds(job):.0f}s — marking it failed")
                ref.update({"status": "error", "error": "The render machine took too long and gave up.", "updatedAt": int(time.time() * 1000)})
            else:
                log(f"{job_id} finished: {status}")
            browser.close()
    except Exception:
        log(f"{job_id} crashed:\n" + traceback.format_exc())
        if not mode["helper"]:
            try:
                ref.update({"status": "error", "error": "The render machine ran into an unexpected problem.", "updatedAt": int(time.time() * 1000)})
            except Exception:
                pass
    finally:
        if gpu_job:
            gpu_job[0].end_job(gpu_job[2])


# A job record that is never deleted would make the whole `cloudExports` node grow forever, and this worker re-downloads that
# WHOLE node on every single poll (the Realtime Database bills by bytes downloaded, not by the number of reads) — exactly the
# mistake that ran up a real bill on a sibling project (see NOTES.md in that project's hf-server-files/). So every finished job
# (done / error / cancelled) is deleted a little while after it finishes, once the owner's own tab has certainly already seen it.
CLEANUP_AFTER_SECONDS = 15 * 60
STALE_AFTER_SECONDS = 2 * 60 * 60  # a job stuck in "pending"/"rendering" this long was abandoned by a worker that crashed or restarted


def cleanup_old_jobs(all_jobs, running):
    now_ms = int(time.time() * 1000)
    for uid, jobs in all_jobs.items():
        if not isinstance(jobs, dict):
            continue
        for job_id, job in jobs.items():
            if not isinstance(job, dict):
                continue
            status = job.get("status")
            age_seconds = (now_ms - int(job.get("updatedAt") or job.get("createdAt") or now_ms)) / 1000
            ref = db.reference(f"cloudExports/{uid}/{job_id}")
            try:
                if status in TERMINAL and age_seconds > CLEANUP_AFTER_SECONDS:
                    ref.delete()
                # not tracked by any live thread here (this worker process restarted, or it died on another one) and clearly abandoned
                elif status in ("pending", "rendering") and (uid, job_id) not in running and age_seconds > STALE_AFTER_SECONDS:
                    log(f"Marking abandoned job {job_id} as failed (no worker has touched it in {age_seconds / 60:.0f} min)")
                    ref.update({"status": "error", "error": "The render machine restarted while this job was in progress. Please try again.", "updatedAt": now_ms})
            except Exception:
                log(f"Could not clean up job {job_id}:\n" + traceback.format_exc())


PART_LEASE_SECONDS = 150          # the same lease the website gives a slice (PART_LEASE_MS in server/cloud-export-store.js)
HELP_ATTEMPTS = 2                 # how many times one machine joins the same running job (a page that keeps failing is left alone)
HELPERS = os.environ.get("HELP_OTHERS", "1") != "0"          # HELP_OTHERS=0: this machine only renders jobs it takes from the queue itself


def free_parts(job, now=None):
    """True when a running job still has a slice nobody works on (open, or taken by a machine that went silent)."""
    now = (now or time.time()) * 1000
    items = ((job.get("parts") or {}).get("items")) or {}
    if isinstance(items, list):
        items = {str(i): v for i, v in enumerate(items) if v}
    for it in items.values():
        if not isinstance(it, dict):
            continue
        if it.get("st") == "open" or (it.get("st") == "taken" and now - (it.get("lease") or 0) > PART_LEASE_SECONDS * 1000):
            return True
    return False


def joinable_jobs(all_jobs, running, tried):
    """Jobs this machine can work on: queued ones (it may become the leader, or a helper if another machine got there first) and running ones that still
    have free slices (it helps). Returns [(uid, job_id, job, helper)]."""
    out = []
    for uid, jobs in all_jobs.items():
        if not isinstance(jobs, dict):
            continue
        for job_id, job in jobs.items():
            key = (uid, job_id)
            if key in running or not isinstance(job, dict) or not job.get("secret"):
                continue
            if job.get("status") == "pending":
                out.append((uid, job_id, job, False))
            elif HELPERS and job.get("status") == "rendering" and free_parts(job) and tried.get(key, 0) < HELP_ATTEMPTS:
                out.append((uid, job_id, job, True))
    return out


def worker_loop():
    running = set()
    slots = set()
    tried = {}
    log("Cloud export worker started.")
    while True:
        try:
            all_jobs = db.reference("cloudExports").get() or {}
            cleanup_old_jobs(all_jobs, running)
            for uid, job_id, job, helper in joinable_jobs(all_jobs, running, tried):
                key = (uid, job_id)
                if len(running) >= MAX_CONCURRENT:
                    break
                if key in running:
                    continue
                running.add(key)
                if helper:
                    tried[key] = tried.get(key, 0) + 1
                slot = next(i for i in range(MAX_CONCURRENT) if i not in slots); slots.add(slot)

                def run(uid=uid, job_id=job_id, job=job, key=key, slot=slot, helper=helper):
                    try:
                        render_one(uid, job_id, job, slot, helper)
                    finally:
                        running.discard(key); slots.discard(slot)

                threading.Thread(target=run, daemon=True).start()
        except Exception:
            log("Worker loop error:\n" + traceback.format_exc())
        time.sleep(POLL_SECONDS)


_ready = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ready
    _ready = init_firebase() and bool(SITE_URL)
    if not _ready:
        log("Worker NOT started (see the message above). Fix the missing secret and restart this Space.")
    else:
        threading.Thread(target=worker_loop, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def health(key: str = Query(default="")):
    expected = os.environ.get("HQ_ACCESS_KEY")
    if not expected or key != expected:
        raise HTTPException(status_code=403, detail="Forbidden")
    return HTMLResponse(f"<pre>ready: {_ready}\nsite: {SITE_URL}</pre>")


if __name__ == "__main__":
    # Hugging Face Docker Spaces run `python app.py` directly — nothing starts the ASGI server unless this does it.
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
