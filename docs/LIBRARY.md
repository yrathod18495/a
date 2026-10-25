# Character library in R2 (one place for every rig, atlas and picture)

The ready-made characters (Neha, My Baby, Village Boy, SVG Multi, Sadhu Baba, Chudel) and their animations are about **137 MB in 1,734 files**
(`public/12toons`). Serving them with the website costs Vercel bandwidth and makes every deployment heavy. They now live in **one public R2 bucket**
and the browser fetches every character file from there.

```
<library bucket>/v1/12toons/characters.json, animations.json, groups.json
                  v1/12toons/chars/<character>/<pose>_ske.json, <pose>_tex_N.json, <pose>_tex_N.webp, anims/...
                  v1/12toons/anims/<pose>/...        shared animations
                  v1/12toons/pose/<character>-<pose>.webp   thumbnails
```
Why a **second, public** bucket: these files are the same for everybody, so they can be cached by the browser and by Cloudflare for a year and need no
login and no server call. Users' own files stay in the **private** bucket (see `docs/COST-PLAN.md`). R2 download traffic is free.

## One-time setup
1. Cloudflare → R2 → **Create bucket** (for example `12toons-library`).
2. Bucket → Settings → **Public access**: enable the `r2.dev` address (fine to start; for a busy site connect a custom domain such as `cdn.yourdomain.com`, which also gets Cloudflare's cache).
3. Bucket → Settings → **CORS policy** (the browser reads the files with `fetch`):
   ```json
   [{ "AllowedOrigins": ["https://a-two-roan-17.vercel.app"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```
4. Upload everything (on your computer, in the project folder; the R2 API token needs *Object Read & Write* on this bucket):
   ```
   CLOUDFLARE_R2_ACCOUNT_ID=... CLOUDFLARE_R2_ACCESS_KEY_ID=... CLOUDFLARE_R2_SECRET_ACCESS_KEY=... CLOUDFLARE_R2_LIBRARY_BUCKET=12toons-library \
   node scripts/upload-library.mjs
   ```
   `--dry` only lists what would be uploaded; running it again skips files that are already there.
5. Vercel → Settings → Environment Variables: `VITE_LIBRARY_URL` = `https://<your public bucket address>/v1` (no slash at the end), then **Redeploy**.
   (`VITE_` values are read when the site is built, so a redeploy is needed.)

Until `VITE_LIBRARY_URL` is set the copy bundled with the site is used, so nothing breaks while you set this up.

## Changing a character later
Files are cached for a year and never overwritten. To publish a change: upload to a **new prefix** (`node scripts/upload-library.mjs --prefix v2`), then change
`VITE_LIBRARY_URL` to `.../v2` and redeploy. Old visitors keep working on `v1` until they reload.

## After everything works
When the site loads characters from the bucket (open DevTools → Network: requests go to your bucket address), `public/12toons/chars`, `anims` and `pose` can be
removed from the repository to make deployments lighter. Keep `public/12toons/characters.json`: the server reads it to check animation targets.
