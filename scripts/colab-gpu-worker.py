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
GPU_ENCODE = False        # True = ffmpeg/NVENC encodes (measured SLOWER than the browser's own encoder on Colab's 2 CPU cores); leave False
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

print("Upload the LATEST app.py + gpu_encode.py + your Firebase key .json now (all together). If nothing new is needed, just cancel the dialog and the files already in Colab are used.")
incoming = files.upload()
for name, content in incoming.items():
    base = pathlib.Path(name).name
    if re.fullmatch(r"app(?: \(\d+\))?\.py", base, re.I):
        APP_PATH.write_bytes(content)
    elif re.fullmatch(r"gpu_encode(?: \(\d+\))?\.py", base, re.I):
        (ROOT / "gpu_encode.py").write_bytes(content)
    elif base.lower().endswith(".json"):
        try:
            d = json.loads(content.decode("utf-8-sig"))
            if d.get("type") == "service_account" and d.get("private_key"):
                KEY_PATH.write_text(json.dumps(d)); KEY_PATH.chmod(0o600)
        except Exception:
            pass
NEEDED = ("def render_one(uid, job_id, job, slot=0)", "def nvidia_gpu_available", "def webgl_is_hardware")
def app_is_current():
    return APP_PATH.exists() and all(n in APP_PATH.read_text(encoding="utf-8-sig") for n in NEEDED)
if not app_is_current():
    print("The app.py in Colab is OLD. Upload the LATEST app.py now (the file named app.py that was sent with this script).")
    for name, content in files.upload().items():
        if re.fullmatch(r"app(?: \(\d+\))?\.py", pathlib.Path(name).name, re.I):
            APP_PATH.write_bytes(content)
    if not app_is_current():
        raise RuntimeError("That app.py is still the old one. Use the latest hf-cloud-export/app.py (commit 1c3fecb or newer).")
src = APP_PATH.read_text(encoding="utf-8-sig")
if not valid_key(KEY_PATH):
    raise RuntimeError("Firebase service account JSON missing.")

os.environ.update(FIREBASE_SERVICE_ACCOUNT_KEY=KEY_PATH.read_text(), FIREBASE_DATABASE_URL=FIREBASE_URL, SITE_URL=SITE_URL,
                  MAX_CONCURRENT=str(JOBS_AT_ONCE), CLOUD_RENDER_WORKERS=str(FRAME_WORKERS), GPU_ENCODE="1" if GPU_ENCODE else "0", PROFILE_DIR="/tmp/12toons-profiles")
pathlib.Path(os.environ["PROFILE_DIR"]).mkdir(parents=True, exist_ok=True)

if subprocess.run(["nvidia-smi"], capture_output=True).returncode != 0:
    raise RuntimeError("No NVIDIA GPU: Runtime > Change runtime type > T4 GPU.")
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "firebase-admin", "fastapi", "uvicorn", "playwright", "psutil", "websockets"], check=True)
subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
import psutil

sys.path.insert(0, str(ROOT))          # app.py imports gpu_encode.py from here
sys.modules.pop("gpu_encode", None); importlib.invalidate_caches()          # a copy of gpu_encode kept in memory from an earlier run of this cell would be used instead of the file just uploaded
try:
    import gpu_encode
    print("gpu_encode version:", getattr(gpu_encode, "VERSION", "OLD (no version: restart the runtime and upload again)"))
    print("GPU video encoding:", "switched OFF in the settings (GPU_ENCODE = False): the browser's own encoder is used" if not GPU_ENCODE else ("READY (ffmpeg " + gpu_encode.CODEC + ")" if gpu_encode.selftest() else "OFF (see the reason above)"))
except ImportError:
    print("GPU video encoding: OFF (gpu_encode.py was not uploaded)")
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

def scan():
    """(jobs this machine can work on, status counts): queued jobs, and running jobs that still have free slices to help with"""
    data = worker.db.reference("cloudExports").get() or {}
    counts = {}
    for rows in data.values():
        if isinstance(rows, dict):
            for job in rows.values():
                if isinstance(job, dict): counts[job.get("status", "?")] = counts.get(job.get("status", "?"), 0) + 1
    return data, counts

print(f"\nREADY | jobs at once: {JOBS_AT_ONCE} | frame workers per job: {FRAME_WORKERS or 'auto'} | CPU cores: {os.cpu_count()}")
input("Start the cloud exports on the website, then press Enter: ")

from concurrent.futures import ThreadPoolExecutor
pool = ThreadPoolExecutor(max_workers=max(1, JOBS_AT_ONCE))
running, slots, tried, results = {}, set(), {}, []
t0 = time.monotonic(); idle_since = None; last_scan = 0; todo = []
try:
    while time.monotonic() - t0 < MAX_SESSION_MINUTES * 60:
        for fut in list(running):
            if fut.done():
                uid, jid, slot, started, helper = running.pop(fut); slots.discard(slot)
                try: fut.result()
                except Exception as e: print("Worker exception:", jid, e)
                row = worker.db.reference(f"cloudExports/{uid}/{jid}").get() or {}
                took = time.monotonic() - started
                results.append((jid, "helper" if helper else row.get("status"), round(took, 1)))
                print(f"\nFINISHED {jid} ({'helped' if helper else row.get('status')}) in {took:.0f} s {row.get('error') or ''}")
        if time.monotonic() - last_scan >= POLL_SECONDS:
            data, counts = scan(); last_scan = time.monotonic()
            todo = worker.joinable_jobs(data, {(u, j) for u, j, _, _, _ in running.values()}, tried)
            print(f"\nTo do here: {len(todo)} | statuses: {counts}")
        for uid, jid, job, helper in todo:
            if any((uid, jid) == (u, j) for u, j, _, _, _ in running.values()): continue
            if len(running) >= capacity(): break
            slot = next(i for i in range(max(1, JOBS_AT_ONCE)) if i not in slots); slots.add(slot)
            if helper: tried[(uid, jid)] = tried.get((uid, jid), 0) + 1
            running[pool.submit(worker.render_one, uid, jid, job, slot, helper)] = (uid, jid, slot, time.monotonic(), helper)
            print(f"STARTED {'(helping with) ' if helper else ''}{jid} in slot {slot} | active {len(running)}")
        if not running and not todo:
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
