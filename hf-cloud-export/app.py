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

See ../docs/CLOUD-EXPORT.md for how to create this Space, what to put in each secret, and how to test the whole pipeline once.
"""
import json
import os
import threading
import time
import traceback
from datetime import datetime

import firebase_admin
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from firebase_admin import credentials, db
from playwright.sync_api import sync_playwright

SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
POLL_SECONDS = 4          # how often this worker checks the database for new jobs
MAX_CONCURRENT = 2        # how many renders run in parallel on this machine
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
    # a generous ceiling so a stuck render does not tie up this worker forever: the video's own length, generously padded, plus a fixed floor
    seconds = float(job.get("seconds") or 30)
    return max(180, seconds * 6 + 120)


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
            browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page(viewport={"width": 960, "height": 720})
            page.on("console", lambda m: log(f"[{job_id}] page: {m.text[:300]}"))
            page.on("pageerror", lambda e: log(f"[{job_id}] page error: {e}"))
            page.goto(url, wait_until="load", timeout=60_000)
            status = "pending"
            while time.time() < deadline:
                current = (ref.get() or {})
                status = current.get("status", "pending")
                if status in TERMINAL:
                    break
                time.sleep(POLL_SECONDS)
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


app = FastAPI()
_ready = False


@app.on_event("startup")
def startup():
    global _ready
    _ready = init_firebase() and bool(SITE_URL)
    if not _ready:
        log("Worker NOT started (see the message above). Fix the missing secret and restart this Space.")
        return
    threading.Thread(target=worker_loop, daemon=True).start()


@app.get("/")
def health(key: str = Query(default="")):
    expected = os.environ.get("HQ_ACCESS_KEY")
    if not expected or key != expected:
        raise HTTPException(status_code=403, detail="Forbidden")
    return HTMLResponse(f"<pre>ready: {_ready}\nsite: {SITE_URL}</pre>")
