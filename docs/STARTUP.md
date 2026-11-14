# Start-up rules: the first screen never waits for the server (permanent rule)

A page load that waits for several serverless calls feels broken on a phone ("Getting things ready…", "This page is slow to open"). Cold serverless functions, a far-away region and a weak connection add up, so **nothing the server must answer may stand between the user and the first screen.**

## How the start works (`src/shell.js` → `start()`, `src/firebase.js` → `onUser`, `src/boot-cache.js`)

1. **Who is signed in** comes from this device (Firebase restores it locally). No request. A visitor who is signed out sees the home page at once, with no server call at all.
2. **The first screen uses what the last visit learned** (`readBoot` / `saveBoot`: role, maintenance, tool switches, kept per account). With nothing saved it assumes "a normal user, no maintenance".
3. **One request in the background**: `POST /api/security { action: 'boot' }` returns `{ admin, maintenance, features }` and also checks the session and records "last seen". Its answer replaces the remembered one (`applyAnswer`); the page is opened again **only if the answer differs** from what was shown.
4. **Only a definite "no" signs the user out**: 401 / 403 (ended session, blocked account). A slow or failed connection never does; the check is retried quietly (`bootCheck` in `src/firebase.js`).
5. **A sign-in that has just happened** (a fresh Google sign-in starts a new session) waits for the one answer, at most 8 s; a late answer is still applied.
6. If the sign-in state itself never arrives (blocked storage, an in-app browser) the page opens as for a signed-out visitor after 10 s and the account is picked up when it arrives.
7. Side jobs never block the first page: the live-chat button, the partner referral, the profile and project sync, the dashboard's cloud line (remembered for 10 minutes).

## Rules for any future change

- Do not `await` an API call (or a dynamic import that needs the network) before the first `route()`. Put it in the background and apply its result when it arrives.
- Do not turn "could not ask" into a bad state (not admin, maintenance on, signed out). Keep what is known and retry.
- Keep `api/security.js` light: it answers every page load (`boot`, `maintenanceStatus`, `heartbeat`). Heavy modules (the S3 library, payments) are loaded with `import()` only in the action that needs them (`serviceStatus`).
- Anything slow on the server that is not part of the answer (Telegram notes, push) goes through `inBackground()` (`server/background.js`).
- The start-up is traced: `window.__12toonsBoot` lists the stages with their times, and the "Taking longer than usual" screen prints where it stopped.
- Tests: `tests/browser/boot-fast.spec.js` (the home page opens in under 8 s while every API call hangs), `tests/boot-api.test.js`.

## One thing to check outside the code

Vercel runs the API functions in one region (default: Washington). If the Firestore database is somewhere else (for example Mumbai), every server call crosses the world. Put them in the same region: Firebase console → Firestore → Data (the location is shown in the Rules / Settings area), then `"regions": ["bom1"]` (Mumbai) or the nearest in `vercel.json`.
