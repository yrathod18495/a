# Cost plan: where data lives, what it costs, and what to set up

Goal: run 12toons for about **3,000 active users a day** on (almost) free tiers of Firestore, Realtime Database (RTDB) and Cloudflare R2.
Prices below are the public price lists as I know them; **check the official pages before you rely on a number** (they change).

## 1. Prices and free limits

| Service | Free | After the free part |
|---|---|---|
| **Firestore** (per day) | 50,000 reads · 20,000 writes · 20,000 deletes · 1 GiB stored · 10 GiB/month network | reads $0.03 / 100k · writes $0.09 / 100k · deletes $0.01 / 100k · storage $0.15 / GiB-month (multi-region about double) |
| **Realtime Database** (per month) | 1 GB stored · 10 GB downloaded | $5 / GB stored · $1 / GB downloaded. **No charge per read or write**, only bytes |
| **Cloudflare R2** (per month) | 10 GB stored · 1 million Class A (write / list) · 10 million Class B (read) | $0.015 / GB-month · Class A $4.50 / million · Class B $0.36 / million · **download traffic is free** |
| **Vercel** functions | Hobby: about 1 million calls / month (for personal, non-commercial use); Pro includes 1 million then about $0.60 / million | a commercial site needs Pro |

What follows from the prices:
- Firestore **counts every read and write**, so it is for money records and things that need queries.
- RTDB counts **bytes**, so many small, frequent writes are free; keep nodes small and never download big nodes often.
- R2 counts **requests**, not bytes downloaded: a few big files are cheap, many tiny requests are not. Never list the bucket.

## 2. Where each kind of data lives

| Data | Where | Why |
|---|---|---|
| Pictures, audio, character pages, project snapshots | **R2** | big files; one request each, no egress fee |
| Project index (name, revision, summary, last 10 saves), file registry (`assets/<uid>/<hash>` = size), storage usage (`usage/<uid>`), shared studio assets list | **RTDB** | small, changes often, no per-operation charge |
| Payments, plans, affiliates, support chat, security events / audit / alerts, account status, admin list, session lease | **Firestore** | needs queries, transactions and rules; low volume |
| Local project copy, uploaded-file list, downloaded-file cache | the user's **browser** (IndexedDB, localStorage, Cache Storage) | free, instant, works offline |

### R2 layout (everything of one user under `u/<uid>/`)
```
u/<uid>/a/<first 2 hex of sha256>/<sha256>     pictures, audio, character pages (shared by all projects, never uploaded twice)
u/<uid>/p/<projectId>/state-<opId>.json        the project snapshot (only the newest is kept, the older one is deleted on save)
```
### RTDB layout
```
projects/<uid>/<projectId>   { name, kind, revision, stateOp, summary, activity[last 10], updatedAt }
assets/<uid>/<sha256>        size in bytes (file is in R2)
usage/<uid>                  { bytes, objects }
studioAssets/<id>            shared props / effects / backgrounds / animations (admin)
config/*                     (rules file allows signed-in read; server writes)
```

## 3. What was costing money, and what changed

| Before | After |
|---|---|
| Cloud save ran 1.2 s after every edit | runs **45 s after the last edit** (at most every 3 min, at once when the tab is hidden or closed) |
| Every file: ~10 R2 requests (HEAD, chunk HEAD, PUT, GET back, HEAD, LIST ...) and the whole user folder was **listed on every upload** for the quota | **1 signed PUT per new file**, no listing; usage is a counter in RTDB; files the browser already uploaded cost nothing |
| Every save: a **new snapshot file** (never deleted), the server downloaded it and HEADed every asset | one snapshot file (older deleted), server only HEADs the **new** files |
| Project index + activity: 2 Firestore writes + 4 reads per save | RTDB (free per operation) |
| Session heartbeat every **60 s**: 3 reads + 1 transaction + 1 write | every **5 min**, **1 read**, a write only when less than half of the 15-minute lease is left |
| Reloading the page wrote 4 Firestore documents (a "login") | a reload on the same browser writes **nothing** |
| 3 Firestore reads on every API call | remembered for 60 s on the server (Vercel) |
| Tester config polled **every second** | every 30 s (and at once when the tab comes back) |
| Live chat polled every 3 s and read **200 messages each time** | asks only for newer messages, every 5 s → 15 s → 30 s while quiet |
| Admin pages polled every 3 s | 10–30 s |
| Shared config, profile and character list read at every start | kept on the device for 10 min / 12 h / 5 min |
| Studio assets list from Firestore | RTDB, plus a short server cache |
| Downloads fetched through the server (base64) | signed links, **browser cache** by hash |

## 4. Estimate for 3,000 users a day
Assumptions: 1.3 sessions a day of about 25 minutes, 8 cloud saves a day each (half of them with one new file), 1 project opened per session (most files already in the browser cache), heartbeat every 5 minutes.

| Item | Per day | Per month | Free limit | Likely cost |
|---|---|---|---|---|
| R2 Class A (signed PUTs) | ~36k | ~1.1 M | 1 M | ~$0.4 |
| R2 Class B (HEADs + downloads) | ~44k | ~1.3 M | 10 M | $0 |
| R2 storage (about 5 MB per active user) | – | ~15–50 GB | 10 GB | ~$0.1–0.6 |
| Firestore reads | ~100k | – | 50k / day | ~$0.5 |
| Firestore writes (logins, payments, events) | ~8k | – | 20k / day | $0 |
| RTDB download | ~100 MB | ~3 GB | 10 GB | $0 |
| RTDB storage | – | ~0.2 GB | 1 GB | $0 |
| Vercel calls (heartbeat 20k + saves 48k + others) | ~100k | ~3 M | 1 M (Hobby) | Pro plan (about $20) |

Before the change the same traffic was roughly **$150–200 a month** (R2 requests dominated, then Firestore); now it is **a few dollars plus the Vercel plan**. These are estimates; watch the real numbers in the first week.

## 5. One-time setup (you do this)
1. **Realtime Database**: Firebase Console → Build → Realtime Database → Create database → region close to your users (e.g. `asia-southeast1`) → start in locked mode. Open the **Rules** tab and paste the content of `database.rules.json` (or `firebase deploy --only database`).
2. **Vercel → Settings → Environment Variables**: add `FIREBASE_DATABASE_URL` (the URL shown at the top of the Data tab) next to the existing `FIREBASE_ADMIN_CREDENTIALS`, the four `CLOUDFLARE_R2_*` values and `MAINTENANCE_MODE`. Redeploy.
3. **R2 bucket CORS** (the browser now talks to R2 directly): Cloudflare → R2 → your bucket → Settings → CORS policy:
   ```json
   [{ "AllowedOrigins": ["https://YOUR-SITE.vercel.app"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
   (add your own domain too if you use one).
4. **Check it**: `node scripts/check-r2.mjs https://YOUR-SITE.vercel.app` with the four R2 variables set. It uploads and downloads with signed links, deletes, and tells you if CORS is wrong.
5. **Budgets**: Google Cloud Billing → Budgets & alerts (e.g. $5 and $20), Cloudflare → Notifications (R2 usage), Vercel → Spend management.

Without step 1 the project list and cloud saving answer "Server par Realtime Database abhi set nahi hai"; everything keeps working on the device.

## 6. If a number goes up
- **R2 Class A**: raise `SAVE_QUIET` in `src/project-sync.js` (60–90 s), or save snapshots less often.
- **Vercel calls**: lengthen the heartbeat in `src/session.js` (the lease is 15 minutes, so up to 7 minutes is safe).
- **Firestore reads**: raise `ACCESS_CACHE_MS` (default 60 s) in `server/access.js`.
- **Storage**: lower `MAX_USER` in `server/r2-storage.js` (300 MB now), or add a clean-up job for files no project uses any more (files are never deleted automatically; a deleted project keeps its pictures).
