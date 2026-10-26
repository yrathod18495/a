# Character library in R2 (optional, for when you want to lighten the repository)

The ready-made characters (Neha, My Baby, Village Boy, SVG Multi, Sadhu Baba, Chudel) and their animations are about **137 MB in 1,734 files** in `public/12toons`.
**Today they are still in git and served with the site**, so nothing depends on R2 yet. The tooling below is ready for the day you want them in **the same 12toons R2 bucket, in their own folder**.

```
<your bucket>/lib/v1/12toons/characters.json, animations.json, groups.json, library-manifest.json
                             chars/<character>/<pose>_ske.json, <pose>_tex_N.json, <pose>_tex_N.webp, anims/...
                             anims/<pose>/...           shared animations
                             pose/<character>-<pose>.webp   thumbnails
              u/<uid>/...                              users' own files (see docs/COST-PLAN.md)
```

## How a file would reach the browser
The app asks for `/12toons/chars/neha/front_ske.json`. If the file is in `public/` Vercel serves it directly (that is the case today). If it is not, `vercel.json` sends the request to
`api/library.js`, which checks that the path is a plain library file, signs an R2 link for `lib/v1/12toons/<path>` and answers with a **redirect** that is cached for 5 days (browser and Vercel's edge).
The bucket **stays private**: only files inside `lib/` can be reached this way, nothing under `u/`. No new variable and no second bucket are needed.
(`public/12toons/characters.json` must stay in the repository: the server reads it.)

## Upload to R2 (safe to do any time; nothing changes for users until the files are removed from `public/`)
```
CLOUDFLARE_R2_ACCOUNT_ID=... CLOUDFLARE_R2_ACCESS_KEY_ID=... CLOUDFLARE_R2_SECRET_ACCESS_KEY=... CLOUDFLARE_R2_BUCKET_NAME=<your 12toons bucket> \
node scripts/upload-library.mjs
```
`--dry` only lists the files; running it again skips files already there. It also writes `lib/v1/12toons/library-manifest.json`. The bucket CORS must allow `GET` from your site (same rule as in `docs/COST-PLAN.md`).

## Switching over (later, when you decide)
1. Upload (above) and check that `https://<your site>/12toons/...` works for a file that is *not* in `public/` (for example from a preview deployment without the files).
2. Remove `public/12toons/chars`, `anims`, `pose`, `animations.json`, `groups.json` (keep `characters.json`) and `public/local-character-art` from git. The files stay in history, `git checkout <commit> -- public/12toons` brings them back.
3. For development and the browser tests, `LIBRARY_SITE=https://your-site.vercel.app npm run library:pull` downloads the library into `public/12toons` again.

If the library cannot be loaded the character picker says so in simple Hinglish instead of staying empty.

## Changing a character later
Files are cached for days and never overwritten. Upload to a **new folder** (`--prefix lib/v2`), set `LIBRARY_PREFIX=lib/v2` in Vercel and redeploy.

## Limits worth knowing
- Vercel's free plan allows 12 functions and the project has exactly 12 (`api/library.js` is the 12th), so a new API has to be added to an existing function.
- The git history holds the files (about 50 MB). `git filter-repo` could shrink it, but it changes every commit id and breaks other people's clones, so it is not done automatically.
