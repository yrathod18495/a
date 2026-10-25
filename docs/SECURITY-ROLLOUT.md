# Security and project storage rollout

## Release status

Local implementation and automated checks are available. Production Firebase Auth, the named Firestore database, R2 and Vercel configuration have not been verified. Do not treat mocked API tests as live integration evidence. Coordinate backend and rules deployment before releasing this login change.

## Server configuration

Set these in the Vercel server environment, never with a `VITE_` prefix:

- `FIREBASE_ADMIN_CREDENTIALS`: service-account JSON with permission to verify/revoke-check Firebase tokens, mint custom tokens, list Auth users and read/write the intended Firestore database. An Application Default Credentials environment can be used instead.
- `FIREBASE_PROJECT_ID`: defaults to `twelvelabs-studio-209137-11a91`. Keep it aligned with the frontend project; credentials must belong to this Firebase project.
- `FIRESTORE_DATABASE_ID`: defaults to `(default)`. Verify this matches the client database.
- `MAINTENANCE_MODE`: the site is in **maintenance until this is exactly `false`** (unset or any other value = maintenance). In maintenance only admins can use the studio, projects, R2 files, payments, export and chat; everyone else sees "We'll be back soon" and the APIs answer 503. Set it to `false` in Vercel and redeploy to open the site to users.
- `FIREBASE_DATABASE_URL`: the Realtime Database URL (project index, file registry, usage, studio assets). Without it cloud saving answers in Hinglish that it is not set up. See `docs/COST-PLAN.md` for the setup and the R2 CORS rule.
- `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`: private bucket credentials with the required read/write/list permissions.

Google sign-in and the preview/production authorized domains must be enabled. The frontend Firebase config is public; service-account and R2 credentials are secrets. A plain Vite development server does not run the serverless APIs.

## Admin bootstrap and rules

Using a trusted Firebase console or administrative server, create `securityAdmins/<Firebase Auth UID>` with boolean `enabled: true` in the intended database. Use the verified UID, not an email allowlist. Clients cannot grant this role. Preserve a trusted administrative recovery path outside the web UI.

Back up the currently deployed rules and compare them with `firebase/firestore.rules`. Merge any unrelated application paths deliberately. Remove overlapping broad allow rules: Firestore combines matching allows, so a broad old rule can bypass the new restrictions. Deploy to the correct named database only after reviewing the effects on existing clients. The new rules require a live server session claim and will reject older client tokens. No production rules were deployed during this task.

## Preview verification before main release

Use an isolated Firebase project/database and private R2 bucket with two test accounts plus an admin. Configure a Vercel preview with the matching frontend and backend values.

1. Sign in through real Google Auth; confirm custom session-token exchange and heartbeat. Open another browser: concurrent login must be rejected. Log out, revoke and expire sessions; verify subsequent API requests fail.
2. Use a different account in the same installation; verify pending review, admin approval/rejection and audit records. Clearing browser storage changes the installation ID; this is a risk signal, not proof of identity.
3. Create multiple projects in both studios. Edit rigs, layers, face settings, textures, audio, clips and cameras. Reload, rename and delete. Verify each project remains isolated.
4. Edit offline, reconnect, then restore on another browser after clearing its cache. Compare actual binary bytes and rendered state. Interrupt an upload and its commit response; retry. Make concurrent edits and resolve the conflict by preserving the local copy.
5. Block, restrict, temporarily suspend, restore and revoke a test user. Check both direct Firestore requests and every R2 gateway operation. A revoked session must fail on the next chunk request.
6. Verify legacy browser/cloud recovery without deleting old data. Validate the full production asset catalog and WebM/MP4 exports; local browser tests use a synthetic DragonBones fixture.

## Storage and compatibility

R2 transfers use authenticated JSON requests with 2 MiB chunks, content hashes and immutable object recipes. No new presigned download URLs are issued. Previously issued URLs may remain valid until their original expiry (the previous implementation allowed up to one hour). Already downloaded data cannot be recalled.

Limits are 40 MiB per logical file and 300 MiB per user in stored objects. Quota checks are not a transactional reservation across simultaneous uploads. Project deletion is a metadata tombstone; old immutable objects/chunks are retained. Garbage collection is not implemented, so old revisions and interrupted uploads can consume quota. Do not delete chunks without tracing all live object references.

Legacy raw R2 files remain readable. New chunk recipes require this gateway; rolling back to an older backend without a compatibility reader would break new saves. Back up metadata and retain the compatible reader during rollback. Legacy browser migration requires explicit ownership confirmation because the old database did not record its owner.

No credit ledger existed in the inspected code; this change does not invent credit balances or adjustment endpoints.

## Reproducible local checks

- `npm ci`, then `npm test` (Node with experimental module mocks; Firebase/R2 mocked).
- `npm run build`.
- `npm run test:browser` (installed Microsoft Edge; local Vite server).
- Start a compatible Firestore emulator on `127.0.0.1:8089` for project `demo-12toons`, then `node --test tests/firestore.rules.spec.js`. The direct emulator JAR used locally was version 1.19.8 on Java 17; it is not committed. New Firebase CLI versions may require Java 21.
- `npm audit --omit=dev`.

This checkout began as a source snapshot of remote main `6a72ce23099ac93dac6c67601a39182bed7962a6`; large public assets were not downloaded. Publish changed paths against the existing remote tree, preserving all other files. Do not replace the remote tree with this local snapshot.
