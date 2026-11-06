# ============================================================
# 12TOONS - COLAB GPU WORKER (runs hf-cloud-export/app.py as it is)
# Put this in ONE Colab cell (runtime: T4 GPU). Upload the LATEST app.py + Firebase key.json when asked.
#
# What it does: starts the real worker code (no patching), gives every job its own browser profile slot,
# runs JOBS_AT_ONCE jobs together, and prints how long each job took + live GPU/CPU use, so you can compare
# settings on the SAME project and keep the fastest one.
# ============================================================
import os, re, sys, json, time, pathlib, threading, subprocess, importlib.util

from google.colab import files

# ----------------- settings to experiment with -----------------
JOBS_AT_ONCE = 1          # how many exports render together (Colab has only 2 CPU cores: 1 is usually fastest per video)
FRAME_WORKERS = 0         # frame workers inside ONE video: 0 = automatic (min(4, CPU cores)); try 2, 3, 4
POLL_SECONDS = 8
IDLE_STOP_SECONDS = 120
MAX_SESSION_MINUTES = 120
FIREBASE_URL = "https://twelvelabs-studio-209137-11a91-default-rtdb.firebaseio.com/"
SITE_URL = "https://a-two-roan-17.vercel.app"
# ----------------------------------------------------------------

ROOT = pathlib.Path("/content"); APP_PATH = ROOT / "app.py"; KEY_PATH = ROOT / "key.json"

def valid_key(path):
    try:
        d = json.loads(path.read_text(encoding="utf-8-sig"))
        return d if d.get("type") == "service_account" and d.get("private_key") else None
    except Exception:
        return None

have_app = APP_PATH.exists(); have_key = KEY_PATH.exists() and valid_key(KEY_PATH)
incoming = {}
if have_app and have_key:
    if input("Enter = reuse existing files | U = upload updated files: ").strip().lower() in ("u", "upload"):
        incoming = files.upload()
else:
    print("Upload the latest app.py and the Firebase service-account JSON.")
    incoming = files.upload()
for name, content in incoming.items():
    base = pathlib.Path(name).name
    if re.fullmatch(r"app(?: \(\d+\))?\.py", base, re.I):
        APP_PATH.write_bytes(content)
    elif base.lower().endswith(".json"):
        try:
            d = json.loads(content.decode("utf-8-sig"))
            if d.get("type") == "service_account" and d.get("private_key"):
                KEY_PATH.write_text(json.dumps(d)); KEY_PATH.chmod(0o600)
        except Exception:
            pass
src = APP_PATH.read_text(encoding="utf-8-sig")
for needed in ("def render_one(uid, job_id, job, slot=0)", "def nvidia_gpu_available", "def webgl_is_hardware"):
    if needed not in src:
        raise RuntimeError("This is an OLD app.py. Upload the latest hf-cloud-export/app.py from GitHub (commit 1c3fecb or newer).")
if not valid_key(KEY_PATH):
    raise RuntimeError("Firebase service account JSON missing.")

os.environ.update(FIREBASE_SERVICE_ACCOUNT_KEY=KEY_PATH.read_text(), FIREBASE_DATABASE_URL=FIREBASE_URL, SITE_URL=SITE_URL,
                  MAX_CONCURRENT=str(JOBS_AT_ONCE), CLOUD_RENDER_WORKERS=str(FRAME_WORKERS), PROFILE_DIR="/tmp/12toons-profiles")
pathlib.Path(os.environ["PROFILE_DIR"]).mkdir(parents=True, exist_ok=True)

if subprocess.run(["nvidia-smi"], capture_output=True).returncode != 0:
    raise RuntimeError("No NVIDIA GPU: Runtime > Change runtime type > T4 GPU.")
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "firebase-admin", "fastapi", "uvicorn", "playwright", "psutil"], check=True)
subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
import psutil

spec = importlib.util.spec_from_file_location("twelvetoons_worker", str(APP_PATH))
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
for old in list(worker.firebase_admin._apps.values()):
    worker.firebase_admin.delete_app(old)
if not worker.init_firebase():
    raise RuntimeError("Firebase initialisation failed.")

def sh(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""

def free_vram_mb():
    try: return int(sh(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"]).splitlines()[0])
    except Exception: return 0

def capacity():
    ram_slots = max(1, int(max(0, psutil.virtual_memory().available / 1e9 - 2.5) / 2.5))
    vram_slots = max(1, int(max(0, free_vram_mb() - 2000) / 2500))
    return max(1, min(JOBS_AT_ONCE, ram_slots, vram_slots))

stop_monitor = threading.Event()
def monitor():
    psutil.cpu_percent(None)
    while not stop_monitor.is_set():
        gpu = sh(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,power.draw", "--format=csv,noheader,nounits"])
        print(f"[LIVE] CPU {psutil.cpu_percent(None):.0f}% | GPU util %, VRAM MB, power W: {gpu}", flush=True)
        stop_monitor.wait(8)
threading.Thread(target=monitor, daemon=True).start()

def pending_jobs():
    data = worker.db.reference("cloudExports").get() or {}
    jobs, counts = [], {}
    for uid, rows in data.items():
        if not isinstance(rows, dict): continue
        for jid, job in rows.items():
            if not isinstance(job, dict): continue
            counts[job.get("status", "?")] = counts.get(job.get("status", "?"), 0) + 1
            if job.get("status") == "pending" and job.get("secret"): jobs.append((uid, jid, job))
    return jobs, counts

print(f"\nREADY | jobs at once: {JOBS_AT_ONCE} | frame workers per job: {FRAME_WORKERS or 'auto'} | CPU cores: {os.cpu_count()}")
input("Start the cloud exports on the website, then press Enter: ")

from concurrent.futures import ThreadPoolExecutor
pool = ThreadPoolExecutor(max_workers=max(1, JOBS_AT_ONCE))
running, slots, seen, results = {}, set(), set(), []
t0 = time.monotonic(); idle_since = None; last_scan = 0; queue = []
try:
    while time.monotonic() - t0 < MAX_SESSION_MINUTES * 60:
        for fut in list(running):
            if fut.done():
                uid, jid, slot, started = running.pop(fut); slots.discard(slot)
                try: fut.result()
                except Exception as e: print("Worker exception:", jid, e)
                row = worker.db.reference(f"cloudExports/{uid}/{jid}").get() or {}
                took = time.monotonic() - started
                results.append((jid, row.get("status"), round(took, 1)))
                print(f"\nJOB FINISHED {jid}: {row.get('status')} in {took:.0f} s {row.get('error') or ''}")
        if time.monotonic() - last_scan >= POLL_SECONDS:
            queue, counts = pending_jobs(); last_scan = time.monotonic()
            print(f"\nQueue: {len(queue)} | statuses: {counts}")
        for uid, jid, job in queue:
            if (uid, jid) in seen: continue
            if len(running) >= capacity(): break
            slot = next(i for i in range(max(1, JOBS_AT_ONCE)) if i not in slots); slots.add(slot); seen.add((uid, jid))
            running[pool.submit(worker.render_one, uid, jid, job, slot)] = (uid, jid, slot, time.monotonic())
            print(f"STARTED {jid} in slot {slot} | active {len(running)}")
        if not running and not [j for j in queue if (j[0], j[1]) not in seen]:
            idle_since = idle_since or time.monotonic()
            if time.monotonic() - idle_since >= IDLE_STOP_SECONDS: print("\nQueue idle: stopping."); break
        else:
            idle_since = None
        time.sleep(2)
finally:
    pool.shutdown(wait=True); stop_monitor.set()

print("\n===== REPORT =====")
print(f"jobs at once {JOBS_AT_ONCE}, frame workers {FRAME_WORKERS or 'auto'}")
for jid, status, took in results: print(f"{jid}  {status}  {took} s")
