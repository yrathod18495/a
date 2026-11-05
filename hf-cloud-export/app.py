"""
12toons Cloud Export worker.

What this is: a FastAPI app whose only real job runs in a background thread — it watches the Realtime Database for cloud-export
jobs the website created (api/cloud-export.js, action "create") and opens each one in a headless Chromium tab pointed at a private
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
import threading
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime

import firebase_admin
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from firebase_admin import credentials, db
from playwright.sync_api import sync_playwright

SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
PROFILE_DIR = os.environ.get("PROFILE_DIR", "/tmp/12toons-render-profile")
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


def render_one(uid, job_id, job):
    """Opens the render page for one job and waits for it to finish (or be cancelled), using the admin SDK the whole time — never
    the page's own state. Runs in its own thread so several jobs can render at once (MAX_CONCURRENT)."""
    secret = job.get("secret", "")
    url = f"{SITE_URL}/#/cloudrender/{uid}/{job_id}/{secret}"
    ref = db.reference(f"cloudExports/{uid}/{job_id}")
    deadline = time.time() + job_timeout_seconds(job)
    log(f"Rendering {job_id} for {uid} -> {url}")
    try:
        with sync_playwright() as p:
            # --enable-unsafe-swiftshader: this machine has no real GPU, so WebGL only works at all through software rendering
            # (SwiftShader). Newer Chromium builds no longer fall back to it silently (the "deprecated" warning in the logs) and
            # need this flag, or WebGL — and so every render — could stop working outright after a future browser update.
            # One browser profile kept on this machine for every job: the character pictures and files the render page downloads
            # are cached in it (the Cache API), so the next job with the same characters skips those downloads — less load on the
            # database and on storage, and a faster "Preparing scene" step. Only this worker's own renders use this profile.
            browser = p.chromium.launch_persistent_context(PROFILE_DIR, headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=swiftshader", "--disable-gpu-sandbox"], viewport={"width": 960, "height": 720})
            page = browser.pages[0] if browser.pages else browser.new_page()
            page.on("console", lambda m: log(f"[{job_id}] page: {m.text[:300]}"))
            page.on("pageerror", lambda e: log(f"[{job_id}] page error: {e}"))
            page.goto(url, wait_until="load", timeout=60_000)
            status = "pending"
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
                if status in TERMINAL:
                    break
                # page.wait_for_timeout (not time.sleep): a plain Python sleep blocks this thread without ever handing control
                # back to Playwright's own driver, so console/pageerror messages queued by the browser sat unprinted — sometimes
                # for the ENTIRE render — until the next real Playwright call (browser.close()) finally flushed them all at once.
                # This still waits the same POLL_SECONDS; it's purely so the logs above show up while the render is happening.
                page.wait_for_timeout(POLL_SECONDS * 1000)
            if status not in TERMINAL:
                log(f"{job_id} timed out after {job_timeout_seconds(job):.0f}s — marking it failed")
                ref.update({"status": "error", "error": "The render machine took too long and gave up.", "updatedAt": int(time.time() * 1000)})
            else:
                log(f"{job_id} finished: {status}")
            browser.close()
    except Exception:
        log(f"{job_id} crashed:\n" + traceback.format_exc())
        try:
            ref.update({"status": "error", "error": "The render machine ran into an unexpected problem.", "updatedAt": int(time.time() * 1000)})
        except Exception:
            pass


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


def worker_loop():
    running = set()
    log("Cloud export worker started.")
    while True:
        try:
            all_jobs = db.reference("cloudExports").get() or {}
            cleanup_old_jobs(all_jobs, running)
            for uid, jobs in all_jobs.items():
                if not isinstance(jobs, dict):
                    continue
                for job_id, job in jobs.items():
                    key = (uid, job_id)
                    if key in running or not isinstance(job, dict):
                        continue
                    if job.get("status") != "pending":
                        continue
                    if len(running) >= MAX_CONCURRENT:
                        continue
                    running.add(key)

                    def run(uid=uid, job_id=job_id, job=job, key=key):
                        try:
                            render_one(uid, job_id, job)
                        finally:
                            running.discard(key)

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
