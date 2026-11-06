---
title: 12TOONS Kaggle Render Router
emoji: 🎬
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# 12TOONS Kaggle Render Router — low Firebase reads

Hugging Face Space Firebase ka control plane hai. Pending export par Space Kaggle kernel ko automatically start karta hai. Kaggle online hote hi jobs usko assign hote hain; start/boot fail ho ya configured boot grace expire ho, toh HF renderer fallback leta hai. Kaggle worker 3 minute idle rehne par clean exit karta hai; agla job aane par Space kernel ko phir push/start karega.

## Sirf ye 7 files rakhein

```text
README.md
Dockerfile
requirements.txt
render.py
fleet.py
fleet.html
worker.py
```

## Hugging Face Space secrets (sirf yahin configure karein)

**Settings → Variables and secrets → Secrets**:

- `KEY_JSON`: complete Firebase service-account JSON. Ye sirf HF Space par rahega; Kaggle worker ko kabhi inject/copy nahi hota.
- `KAGGLE_1`: complete Kaggle API `kaggle.json` content: `{"username":"...","key":"..."}`.
- `KAGGLE_2`, `KAGGLE_3`, `KAGGLE_4` ...: optional account-switch choices. Dashboard par ek account select hota hai; unselected credentials parse/query/use nahi hote. Koi fixed maximum account number nahi hai.
- `HF_ACCESS_TOKEN`: Hugging Face User Access Token with **READ** permission. Ye bhi sirf HF Space Secret mein rakhein. HF Space is token ko private Kaggle worker bootstrap ke saath securely inject karta hai; Kaggle par manually Secret add nahi karna.

`HF_ACCESS_TOKEN` is private Space API ke liye hai. Custom `BRIDGE_TOKEN` / `X-Bridge-Token` ka koi use nahi hai. `KEY_JSON` kabhi Kaggle kernel ko nahi bheja jata. Kaggle kernel ko sirf HF Space URL aur HF READ token milta hai, taaki woh Space ke authenticated job APIs use kar sake. Kaggle kernel ko private hi rakhein; bootstrap source mein token hota hai.

## Code-owned Kaggle defaults (Space Variables ki zaroorat nahi)

- **Parallel jobs: `4` on the one selected Kaggle account**, code mein fixed. Ek worker 4 concurrent browser renders chala sakta hai. Iska matlab 4 jobs same 4 CPU cores/RAM share karte hain—per job 4 dedicated cores nahi.
- **Idle shutdown: `3` minutes**, code mein fixed. Worker active jobs finish karke clean exit karta hai. Nayi queue aane par HF Space us account ko phir start karega.
- **GPU preferred by default.** Kaggle kernel metadata mein GPU enabled hota hai. Normal 4-core Kaggle workers par GPU render path use hota hai. `nvidia-smi` missing/unavailable ho toh worker fail nahi hota; software/CPU renderer par continue karta hai.
- **Video encoder fallback is not forced.** Chromium `VideoEncoder` APIs are left unmodified. The browser chooses a supported encoder configuration; the worker does not force `hardwareAcceleration="prefer-hardware"`, because an unsupported hardware profile can fail asynchronously during encoder creation and bypass a configure-time try/catch.
- **NVENC smoke test is diagnostic only.** A passing `h264_nvenc` test proves FFmpeg can access NVENC for synthetic frames; it does not mean the live Vercel/browser render is encoded by NVENC. The current cloud-render page sends frames to its own WebCodecs encoder and this Kaggle package does not receive those frames for FFmpeg encoding. Do not report the live render as NVENC unless the encoder is integrated with the page's actual frame/output pipeline and verified with non-zero encoder utilization.
- **CPU-only threshold: more than 40 logical CPU cores.** Worker more than 40 cores detect kare toh Chromium render path CPU-only select karta hai aur `nvidia-smi` call skip karta hai. Agar account ki previous worker telemetry more than 40 cores batati hai toh next kernel metadata mein `enable_gpu: false` bhi set hota hai. First launch par hardware pehle se known nahi hota, isliye GPU request hoti hai; runtime detection phir bhi CPU-only rendering select karega.
- No `PARALLEL`, `USE_GPU`, or `KAGGLE_IDLE_MINUTES` Secret/Variable required. Defaults code mein hain.
- `AUTO_START_KAGGLE` is enabled in code by default. `AUTO_START_ROUTER` starts the Firebase listener/router when the Space boots.
- `KAGGLE_START_GRACE_SECONDS` (default 420) keeps jobs pending while kernels boot; a clear boot failure sends jobs to HF fallback.
- `KAGGLE_STATUS_CACHE_SECONDS` (default 45) caches Kaggle status CLI checks.
- `FLEET_SPACE_URL` is only an optional URL override; otherwise the Space uses `SPACE_HOST`.

## Runtime compatibility

Docker base `ubuntu22.04` Python 3.10 use karta hai, isliye `requirements.txt` mein Kaggle CLI `1.7.4.5` pin hai. Current Kaggle CLI 1.8+/2.x Python 3.11+ maangta hai; unpinned `kaggle>=1.6` future dependency resolution ko image ke Python version se mismatch kara sakta tha. Kaggle 1.7.4.5 mein kernels push/status/output supported hain. `kernels logs` command is pinned CLI version mein nahi hai; per-step live boot/job logs Fleet stream se aate hain.

## Kaggle account requirements

1. Kaggle account **phone-verified** hona chahiye.
2. Full `kaggle.json` generate karke `KAGGLE_1` secret mein paste karein.
3. Kaggle kernel metadata mein `enable_internet: true` set hota hai. Internet ON zaroori hai; disabled hone par boot logs mein explicit message aayega.
4. GPU default ON hai. `nvidia-smi` missing hone par worker CPU/software rendering par continue karta hai. more than 40 logical CPU cores host par render path automatic CPU-only hota hai.

## Firebase bandwidth optimization

- `/api/kaggle/next` **ab `cloudExports` ka Firebase `.get()` nahi karta**. Ye sirf Space ki in-memory event cache padhta hai.
- Space startup (aur Firebase SDK reconnect) par RTDB `listen()` SSE se `cloudExports` ka snapshot leta hai. Uske baad normal operation mein sirf changed-path `put/patch` events memory cache update karte hain; every 2 seconds full tree download nahi hota. Firebase Admin SDK credential expiry/network reconnect par listener callback reconnect kar sakta hai; reconnect ke baad resync bandwidth possible hai.
- HF fallback aur Kaggle status/progress endpoint bhi isi memory cache ko read karte hain. Per-job progress polling se bhi Firebase tree reads nahi hoti.
- Ek actual job assign hote waqt ek atomic RTDB transaction `pending → rendering` claim karta hai, taaki HF/Kaggle race ya Space restart duplicate render na chala sake. Ye per-poll read nahi hai; normal idle polling cache-only hai. Firebase writes job completion/error, timeout/cleanup aur website ke existing job updates par hote hain.
- Note: first listener sync is still one full `cloudExports` snapshot. RTDB schema mein user-wise nested jobs hain aur current website producer code is repo mein nahi hai; true zero-snapshot indexed queue ke liye producer ko `cloudExportQueue` index writes bhi add karne padenge. Is version mein repeat full scans remove hain.

## Job lifecycle

1. Space boot → Firebase live listener ready → router starts automatically.
2. New pending job arrives → Space pushes Kaggle kernel through Kaggle API.
3. Kaggle boots, reports heartbeat/logs, then long-polls the Space's in-memory queue cache.
4. HF Space sirf dashboard par selected Kaggle account ko start karta hai. Account switch karne par current worker active jobs finish karke exit karta hai; uske baad selected account start hota hai. Kaggle boot fail/timeout ho aur selected worker online na ho toh HF fallback unassigned jobs claim karta hai.
5. Selected Kaggle worker up to 4 jobs concurrently execute karta hai. `KAGGLE_N` secrets sirf manual account switching ke liye hain; accounts parallel mein start nahi hote.
6. No job for 3 minutes → worker process exits normally, Kaggle run completes, and compute session is released by Kaggle. Next job triggers a fresh push.

Root `/` and `/fleet` serve the same mobile-first circular Fleet dashboard. Top Kaggle tabs switch the selected identity; selected worker telemetry, job progress, logs, Start/Stop, Kaggle output, Copy logs and Copy health report stay on this page. Hugging Face Private Space perimeter protects the app; there is no custom `X-Bridge-Token` auth layer. Keep the Space Private and restrict collaborators.

## Remove old files

Delete these legacy files from the Space repo if present:

```text
app.py
colab_agent.py
colab_worker.py
colab_worker.ipynb.txt
index.html
12toons_colab_worker.ipynb.txt
package.json  # unrelated old Node bridge; remove if no other service uses it
```

Also remove any old `BRIDGE_TOKEN` Space Secret. Do not delete `KEY_JSON`, `KAGGLE_1`, or `HF_ACCESS_TOKEN`.

## Troubleshooting

- **Kaggle does not start:** check `KAGGLE_1` and Space logs; verify `HF_ACCESS_TOKEN` has READ permission.
- **Private Space 401/404:** make sure Kaggle bootstrap is using the current HF READ token and Space URL.
- **Internet disabled:** Kaggle Notebook settings → Internet → On.
- **GPU not visible:** worker reports the missing `nvidia-smi` message and continues with CPU/software rendering; check Kaggle Notebook settings if GPU was expected.
- **Four parallel jobs:** code default is four per Kaggle account. Jobs share that worker's CPU cores and RAM. Additional `KAGGLE_N` accounts sirf account-switch tabs hain; scheduler ek waqt mein ek hi identity use karta hai.
- **Orphaned job after Space restart:** after a Space restart, a still-online Kaggle worker claim is restored from Firebase metadata; if the worker is offline beyond `KAGGLE_ORPHAN_CLAIM_SECONDS` (default 180 seconds), the job is marked error instead of sitting in `rendering` for two hours.
- **HF fallback starts too early:** increase `KAGGLE_START_GRACE_SECONDS`; boot failure messages do not wait for the full grace period.


## Kaggle account selection (single identity active)

Add any number of HF Space Secrets named `KAGGLE_1`, `KAGGLE_2`, ...; each value is the full `kaggle.json`. The dashboard shows account tabs. Only the selected account's JSON is parsed and passed to the Kaggle CLI; unselected credentials are not queried or used. Switching accounts asks the current worker to finish active jobs and exit before the newly selected identity is started. This is operational isolation, not a promise that Kaggle cannot associate accounts or network activity.

The root path `/` and `/fleet` serve the same mobile-first circular-metric dashboard.
