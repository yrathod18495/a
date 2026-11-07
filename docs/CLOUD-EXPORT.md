# Cloud export (permanent notes)

"Cloud export" renders the video on a separate machine (a Hugging Face Space) instead of the user's own phone/computer. The design
goal: reuse the real app's rendering code end to end — the worker never reimplements any of it — so a cloud-rendered video is
pixel-identical to a normal export, forever, with no separate code path to keep in sync.

## Why it works this way

- **No separate renderer.** The worker opens the real website in a headless Chromium tab at a private link
  (`#/cloudrender/<uid>/<jobId>/<secret>`). That page loads the project exactly like a returning visitor's browser would, then
  calls the exact same `exportOffline` / `exportParallel` code (`src/exporter.js`) any export uses. Every future feature (new
  Effects, props, shadows, ...) works in cloud export automatically, with zero extra work.
- **The render page is never signed in as the user.** 12toons allows only one active session per account (signing in anywhere
  signs the account out everywhere else — see `src/session.js`). If the render page signed in as the real user, it would kick
  them off their own phone/browser the moment a cloud export started. So it never does: it is always anonymous, and is allowed
  to act only because it carries that job's own random `secret` (minted when the job was created, known only to the server and
  to the worker that reads it with the Admin SDK — never sent to the owner's own, normal, signed-in calls).
- **No new backend.** Everything lives in infrastructure the project already has: the Realtime Database (`cloudExports/<uid>/<jobId>`,
  next to the existing `projects/<uid>/<id>`) and the existing R2 bucket (the finished video is just another content-addressed
  asset, `assets/<uid>/<hash>`, downloaded the exact same way a character picture is). **No new Vercel environment variable is
  needed** — these actions reuse the same `FIREBASE_ADMIN_CREDENTIALS`, `FIREBASE_DATABASE_URL` and the `CLOUDFLARE_R2_*` variables
  that are already set.

## The pieces

| Piece | File(s) | Runs where |
| --- | --- | --- |
| Job API | `api/export.js` (actions prefixed `cloud...`), `server/cloud-export-store.js` | Vercel (existing deployment) |
| Owner's tab: submit / watch / cancel / download | `src/cloud-export.js`, the "Cloud export" card in `tabExport()` in `src/main.js` | the user's own browser, signed in normally |
| Render page | `src/cloud-render.js`, route `#/cloudrender` in `src/shell.js`, `runCloudExportJob()` in `src/main.js` | inside the headless Chromium the worker opens — anonymous, no sign-in |
| Worker | `hf-cloud-export/` (`app.py`, `Dockerfile`, `requirements.txt`, `README.md`) | a Hugging Face Space (Docker), separate from the website |

## The flow

1. The owner, signed in as normal, taps **Start cloud export** in the Export tab (quality/fps/level/format are whatever is
   already selected there). The browser first makes sure the project is saved to the cloud (`syncCurrent()`), then calls
   `api/export` `action:"cloudCreate"`, which checks the account's plan length limit (same rule as a normal export) and writes
   a job to `cloudExports/<uid>/<jobId>` with a random `secret`, `status:"pending"`.
2. The owner's tab polls `action:"cloudStatus"` every ~2.5 s (plain signed-in calls; this never involves the secret) and shows a
   progress bar. It may call `action:"cloudCancel"` at any time while the job has not finished.
3. The Hugging Face worker polls the whole `cloudExports` node with the **Admin SDK** (bypasses all rules — it is a server,
   not a user) for jobs with `status:"pending"`, and for each one opens `{SITE_URL}/#/cloudrender/<uid>/<jobId>/<secret>` in a
   headless Chromium tab.
4. That page (`src/cloud-render.js`) calls `api/export` `action:"cloudFetch"` with `{uid, jobId, secret}` — no Firebase sign-in
   at all, only the secret. The server reads the project's last-saved snapshot straight from R2 (`server/r2-storage.js`,
   `readText`/`getUrl`, the same code the normal sync path uses) and returns the manifest plus a signed download URL for every
   asset it references. The page downloads them, calls `restoreSnapshot()` (`src/store.js`) to put them in this tab's local
   IndexedDB exactly as if this were the owner's own, returning browser, then opens the studio
   (`import('./main.js').then(m => m.openStudio())`) — which loads that snapshot through the completely ordinary project-open
   code path (`boot()` → `restoreProject()` → `loadDoc()`).
5. Once the studio is ready, the page calls the new `runCloudExportJob()` in `src/main.js`: it renders with
   `exportParallel`/`exportOffline` (falling back to one thread if parallel rendering is not available), posting
   `action:"cloudProgress"` every couple of seconds, then hashes the finished video, calls `action:"cloudPresign"` for an R2 upload URL,
   PUTs the bytes straight to R2, and finally calls `action:"cloudComplete"` with the hash and size. The server does a `HEAD` to
   confirm the upload really arrived, registers it in the normal asset/quota ledger (`confirmAssets`), and marks the job
   `status:"done"`.
6. The owner's tab, which has been polling the whole time, sees `status:"done"` and shows a **Download the video** button; it
   calls `api/r2` `action:"urls"` (the same endpoint every other download in the app uses) with the video's hash to get a fresh
   signed link.
7. If anything fails at any point, the page (or the worker, on a timeout) calls `action:"cloudFail"`; the owner's tab shows the
   error. If the owner cancels, the worker notices on its next poll and closes that browser tab early.

## Setting it up

### 1. Create the Hugging Face Space
- New Space → SDK: **Docker**. Upload the four files in `hf-cloud-export/` (`Dockerfile`, `app.py`, `requirements.txt`,
  `README.md` — the `README.md`'s YAML header is what Hugging Face reads to configure the Space itself, so keep it at the top).
- **Settings → Variables and secrets**, add as **Secret** (not Variable — these must stay private):
  - `FIREBASE_SERVICE_ACCOUNT_KEY` — the exact same JSON value already in Vercel's `FIREBASE_ADMIN_CREDENTIALS` for this project.
  - `FIREBASE_DATABASE_URL` — the exact same value already in Vercel's `FIREBASE_DATABASE_URL`.
  - `SITE_URL` — the deployed website's URL, no trailing slash (e.g. `https://a-two-roan-17.vercel.app`).
  - `HQ_ACCESS_KEY` — optional, any password; only unlocks a tiny status page at the Space's root URL.
- The Space restarts itself after secrets are saved. Check its **Logs** tab: it should print `Firebase ready.` then
  `Cloud export worker started.` If it instead prints a missing-secret message, a secret above is missing or misspelled.

### 2. Nothing to add on Vercel
No new environment variable is needed there (see "Why it works this way" above) — only redeploy once this code is merged.

**Do not give cloud export its own `api/*.js` file.** Vercel's Hobby (free) plan caps a project at **12 serverless functions**
total. This project already had exactly 12 `api/*.js` files; adding a 13th (`api/cloud-export.js`, the first version of this
feature) made every deployment fail right after a successful build, with no error in the build log itself — only on the
Deployments list, and the live site kept serving the last good deploy, so nothing looked obviously broken except that new
code never went live. That is why the cloud export actions live inside `api/export.js` instead (named `cloudCreate` /
`cloudCancel` / `cloudStatus` / `cloudFetch` / `cloudPresign` / `cloudProgress` / `cloudComplete` / `cloudFail`, to avoid
clashing with that file's own `status`/`authorize`/`complete`). If a future feature truly needs its own endpoint, first check
the count of files in `api/` — at 12, merge it into the closest existing one instead of adding a 13th, unless the project has
since moved to a paid Vercel plan.

### 3. Verify end to end (do this once, by hand — I could not run this part myself: it needs a real Hugging Face Space, a real
   Firebase project and real R2 credentials, none of which exist in the sandbox this was written in)
1. Open a project in the studio, add a character and an animation, save it to the cloud (wait for "Saved to Cloud" in the
   corner, or just wait — autosave does it).
2. Export tab → **Start cloud export**. It should move to "Waiting for a render machine…" within a couple of seconds.
3. Watch the Hugging Face Space's **Logs**: it should print `Rendering <jobId> for <uid> -> https://.../#/cloudrender/...`.
4. Back in the studio tab, progress should climb and the job should become **Download the video** within roughly the time a
   normal export of that length would take (plus the time to start a browser tab, a few seconds).
5. Tap Download — it should be the same video a normal export of the same project would produce.
6. Try **Cancel** mid-render on a longer project: the studio tab should show the job as cancelled, and the Space's logs should
   show that job's tab closing early on its next poll (within `POLL_SECONDS`, ~4 s).

If step 2–5 does not work, check (in order): the Space's logs for a Python exception; the browser's own devtools console on
the render page if you open `#/cloudrender/...` directly with a job's real values (it logs everything `src/cloud-render.js` and
`runCloudExportJob` do); and that `SITE_URL` in the Space's secrets exactly matches the deployed site (no trailing slash, right
scheme).

## GPU frame-slice parallelism

The cloud-render page uses the same `exportParallel()` path as normal offline export. One video is divided into ordered frame slices; several `exportWorker.js` workers each render and encode their assigned slices, and the page muxes those chunks into one MP4/WebM with the original audio timeline. This is **parallel rendering of one video**, not merely several independent cloud-export jobs.

On the anonymous `#/cloudrender` route, `workerCount()` checks the WebGL renderer. When it detects NVIDIA hardware, it uses up to the machine's reported logical CPU count (capped at four) rather than the conservative `floor(cores / 2)` used for ordinary devices. A query override remains available for controlled tests: `?workers=2`, `?workers=3`, or `?workers=4` (the worker can add it with the optional `CLOUD_RENDER_WORKERS` environment variable, default `0` for automatic selection). Do not raise it blindly: every worker owns a complete DragonBones/WebGL scene and a video encoder, so more workers can increase CPU/GPU contention and memory use instead of reducing render time.

For NVIDIA cloud rendering, WebCodecs is asked to `prefer-hardware` video encoding when that codec/resolution/FPS configuration reports support; the browser's default encoder selection is retried otherwise. `exportWorker.js` applies bounded encoder back-pressure (smaller queues at 4K, larger queues at 1080p and below). Frame rate, resolution, selected quality level, bitrate calculation, audio mix and muxed timeline are unchanged by worker-count selection.

Benchmark one unchanged project at one, two and (only if resources permit) three workers. Compare the complete `Cloud export done` duration and verify audio/video sync and scene continuity. The fastest stable setting is the right setting; 100% GPU utilization is not itself the objective.

## GPU video encoding (ffmpeg + NVENC)

Chrome has no NVENC on Linux, so the render page's own H.264 encoder runs on the CPU; on a GPU machine with few cores (a Colab T4 has 2)
that CPU encoder is the bottleneck while the GPU idles. When the worker finds a working NVIDIA GPU **and** an ffmpeg that can encode with
`h264_nvenc`, `hf-cloud-export/gpu_encode.py` starts a local WebSocket server and `app.py` adds `?gpuenc=<port>.<one-time token>` to the
render page's address. The page (`src/gpu-encode.js`, `exportParallel`, `exportWorker.js`) then sends every raw frame of each slice to
ffmpeg instead of encoding it: one ffmpeg per slice, the slices joined with `-c copy`, the mixed audio encoded to AAC, and the finished MP4
sent back to the page, which uploads it as before. No ordering buffer is needed, the output is a normal H.264/AAC MP4, and nothing
changes for phones/computers (the address has no `gpuenc`). If the GPU encoder cannot start, or fails mid-render, the page falls back to its own
encoder (the cloud job code already retries on one thread). `GPU_ENCODE=0` switches it off; `GPUENC_CODEC=libx264` runs the same path
without a GPU (used by `tests/browser/gpu-encode.spec.js`). The `Cloud export timing (GPU encode)` log line shows where the time goes.

**Measured result (Colab T4, 2 vCPU): it was SLOWER, so it is OFF by default** (`GPU_ENCODE=1` turns it on). The browser's own software
encoder ran at about 1% per 4 s; with raw frames the path ran at about 1% per minute, and with JPEG frames at about 1% per 13 s (CPU 100%, GPU
0-5%). The cost per frame that is left is on the CPU either way: drawing/skinning in JavaScript, reading the picture back from the GPU, and now
JPEG compressing + decoding it. With only two cores that outweighs what NVENC saves. It may pay off on a machine with many cores or at very
high resolutions; measure with the timing lines first (`Cloud export timing so far:` prints per-frame milliseconds for drawing / encoder
hand-over / waiting for the encoder after every slice).

## Several machines render one video (leader + helpers)

Any number of worker machines (a Colab T4, free Hugging Face CPU Spaces, ...) can run the same worker; they all read the same `cloudExports`
queue and none of them needs to be reachable from outside. The render page splits the video into slices of about 4 s and every page that opens
the job claims slices from a shared list (`cloudExports/<uid>/<job>/parts`, code in `server/cloud-export-store.js`, actions `cloudInitParts` /
`cloudClaimPart` / `cloudPartBeat` / `cloudPartPresign` / `cloudPartDone` / `cloudParts` / `cloudPartUrls` in `api/export.js`):
- The first page to create the list is the **leader**: it renders slices too, waits for all of them, joins them with the sound (`exportDistributed`
  in `src/exporter.js`) and uploads the video as before. Every other page is a **helper**: it renders and uploads slices (a small file under
  `u/<uid>/j/<job>/part-N.bin`, deleted when the job is done) and leaves when none is left. A helper can never fail the job.
- A claimed slice has a 150 s lease that its machine renews every 5 s; a machine that vanishes loses its slice to another one.
- Slices from a machine whose encoder differs (so they would not play as one stream) are rendered again by the leader.
- `worker_loop` / `joinable_jobs()` in `app.py` make an idle machine take a queued job or **help** a running one that still has free slices
  (`HELP_OTHERS=0` stops a machine helping). `?dist=0` on the render page makes one machine render everything alone. The Colab cell uses the same functions.
- Tested with two real browser pages and the real list code on an in-memory database (`tests/browser/cloud-distributed.spec.js`): the joined video has every
  frame exactly once. Not tested on real separate machines (no second machine here).

## Paying for a GPU only while there is work (sleep when idle)

A paid GPU Space (e.g. T4 small) can be set to **sleep after N minutes without activity** (Space settings -> Sleep time). Two things make that safe:
- While it works on a job, `app.py` visits the Space's own public address once a minute (`keep_awake()`), because only such visits count as activity: the
  worker's own background thread does not, so without this a render could be cut off by the sleep timer.
- Nothing wakes a sleeping Space except a visit to its address, so the website does it: when a job is created, `api/export.js` visits every address in the
  Vercel variable `CLOUD_WORKER_WAKE_URLS` (comma separated, e.g. `https://<owner>-<space>.hf.space`). Waking takes a minute or two; free CPU Spaces that stay
  awake keep helping meanwhile. The T4 cannot "go to sleep after its GPU part": every slice needs CPU and GPU together, so it works on slices until none are
  left, and sleeps after the idle time you set.

## Limits (v1)
- Renders the **current scene only** (not "export all scenes together"); the Export tab's Scenes dropdown does not apply to
  cloud export yet. Fast-render / live-recording toggle does not apply either — cloud export always renders offline (the whole
  point of doing it on a dedicated machine).
- `MAX_CONCURRENT` in `app.py` (set with the `MAX_CONCURRENT` Space secret/variable, default **1**) is how many videos one
  Space instance renders at once. A free/basic Space has no real GPU, so Chromium renders WebGL in **software** — many times
  slower than on a real phone or computer, and running jobs in parallel splits that already-limited CPU between them, making
  every one of them slower still (this is what made a 77 s video alone take over 9 minutes and still time out — see below).
  Raise `MAX_CONCURRENT` only on a Space with real CPU/GPU headroom to spare (or run more than one Space, each picking up
  whatever is still `pending`).
- Because of that same software rendering, `job_timeout_seconds()` in `app.py` gives a render up to `20× the video's own
  length + 180 s` (floor 300 s) before giving up and marking it failed — a 1080p/60fps video can genuinely take that long on
  a CPU-only machine. If real exports are still timing out, lower the quality/fps the project's own export settings allow
  (cloud export renders with whatever the Export popup was last set to), or move the Space to a GPU tier.
- A job nobody picks up, or that never finishes, auto-fails after a few hours (`TTL_MS` in `server/cloud-export-store.js`) so
  it never looks like it is "still going" forever.

## The render page can read the shared library (characters, animations)

Characters the admin uploaded, and the shared animations, are not part of a project snapshot: the studio fetches them from
`/api/studio-assets` with the owner's sign-in. The render page has none, so without help every such character was silently
dropped from cloud videos ("Uploaded characters are not available", "Please sign in to view the studio asset library"). Now
`src/session.js` `apiCall` sends `/api/studio-assets` calls through `api/export.js` `action:"cloudStudio"` when `setCloudRenderAuth()`
was called (only `cloud-render.js` does). The server checks the job secret, allows only the read-only actions
`list` / `animation` / `get` / `character:list` / `character:files`, and runs the normal handler with an internal `req.cloudOwner`
that `server/access.js` turns into the owner's identity (never for writes or admin). A real HTTP request cannot set that property.

## Where finished videos live (kept 3 days)

A finished cloud video is **not** a normal project asset. It is stored at `u/<uid>/v/<jobId>.mp4` in R2 (limit 1 GB per
video, 3 GB per user in total) and does **not** count against the 300 MB project-asset quota. The job record in
`cloudExports/` is deleted by the worker after 15 minutes, so the long-lived record is `cloudVideos/<uid>/<jobId>` (project name,
size, quality, `expiresAt` = 3 days). `cloudList` / `cloudDownload` / `cloudDelete` (all in `api/export.js`) power the
**My cloud videos** window (`src/cloud-videos.js`) in the profile menu and the Export tab. Expired videos are deleted
lazily whenever that user lists videos or finishes a new one. **To make the 3-day deletion exact even for users who never come
back, add an R2 lifecycle rule once** (Cloudflare dashboard -> R2 -> the bucket -> Settings -> Object lifecycle rules): prefix
`u/` is too broad — use one rule per prefix pattern your plan allows, or simply expire objects whose key contains `/v/` after 3 days.

## Cost safety: the worker cleans up after itself

The worker re-downloads the *whole* `cloudExports` node on every single poll (every `POLL_SECONDS`), because the Realtime
Database has no server-side "give me only pending rows" query across every user. The Realtime Database bills by bytes
downloaded, not by the number of reads — so a node that only ever grows (old finished jobs nobody deletes) would make every
future poll a little more expensive forever. A sibling project hit exactly this bug once (see that project's own
`hf-server-files/NOTES.md`, "the poll safety-nets ... ran up the runaway bandwidth bill"). `app.py`'s `cleanup_old_jobs()`
runs on every poll and prevents it two ways:
- a finished job (`done` / `error` / `cancelled`) is deleted `CLEANUP_AFTER_SECONDS` (15 min) after it finished — plenty of
  time for the owner's own tab, which polls every ~2.5 s, to have already shown the result. (The video itself stays in R2
  forever; only this small progress record is deleted.)
- a job stuck in `pending` / `rendering` for `STALE_AFTER_SECONDS` (2 h) that no live thread on this worker is tracking —
  meaning the worker that was rendering it crashed or restarted — is marked `error` instead of being left there forever.

Net effect: the node can only ever hold jobs from roughly the last couple of hours, so its size (and the cost of polling it)
stays flat no matter how long the Space has been running.

### GPU encoding and the shared-slice path
Only the single-machine path (`exportParallel`) sends frames to the worker's GPU encoder. The shared-slice path (`exportDistributed`) packs browser-encoded slices and never used `?gpuenc=`. So when the page address has `gpuenc`, `runCloudExportJob` renders alone (same as `?dist=0`); without `gpuenc`, nothing changes. A worker log line `Cloud export: GPU encoder connected (h264_nvenc)` confirms the bridge is in use.

### What the Export tab shows (owner's side)
- Clicking Render names each step before anything is sent: "Saving your latest changes…", "Sending your render request…", then "Request sent. Waiting for a render machine…" (a sleeping machine needs about a minute to start).
- Polling asks less often while the job waits for a machine (4 s) or the tab is hidden (10 s), and the panel only redraws when the state, phase or percent changed. The render machine writes progress only when the percent moved and at least 2 s have passed.
- Download: a video under 150 MB is fetched by the page with a live percentage and MB count, then saved as `<name>.mp4`. A bigger one opens the signed link and the browser shows its own progress (the tile says so). `saveCloudVideo(..., onProgress)` reports `(loaded, total)`, or `(null, 0, 'browser')`.
- While waiting: "Request received. Waiting for a render machine… 0:42" (the clock moves every second). When the Space has pushed a Kaggle kernel for the waiting jobs it writes `phase: machine_starting` on them (render.py `_mark_pending_phase`), and the text becomes "A render machine is starting (about 1–2 minutes)…". Once a machine claims the job (status `rendering`, no progress yet): "A render machine picked up your request and is getting ready…". The page's own phases (`loading`, `preparing`, …) replace it.
