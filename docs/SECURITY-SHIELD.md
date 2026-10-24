# Security shield: layers against copying and inspecting

**Honest limit:** a web page runs in the visitor's own browser, so nothing shown there can be made impossible to copy, and developer-tools detection can always be bypassed by a determined person. The layers below make casual copying hard, alert the admin when it is tried, and keep the real protection on the server, where the visitor cannot reach.

## Layer 1 – Server decides (the real protection)
- Every API call needs a verified sign-in, a live server session, and passes the account checks (blocked / suspended / restricted). Admin actions need `securityAdmins/{uid}`.
- Shared library files (props, effects, backgrounds, animations from the admin) are served only through `/api/studio-assets` to signed-in users, in chunks, with sizes and digests checked.
- Export length is decided by the server (`docs` in `PAYMENTS.md`); firestore.rules keep clients out of every security and payment collection.
- Not covered: the bundled template characters and their animations under `/12toons/` are public static files, the same as any website's images. Moving them behind `/api` would close that gap (a larger change).

## Layer 2 – Browser hardening (vercel.json headers)
`X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` (no one can embed the studio to trick clicks), `object-src 'none'`, `base-uri 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (no camera / mic / location / USB), `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Google sign-in popup keeps working) and HSTS. There are no source maps in the build.

## Layer 3 – Shield and alarm (src/shield.js)
For signed-in non-admin creators in the production build only:
- opening the developer tools is detected (console probe + window-size check that must stay for two checks, so a browser side panel alone does not trigger it);
- `F12`, `Ctrl/Cmd+Shift+I/J/C/K`, `Ctrl/Cmd+U`, `Cmd+Option+I/J/C/U` are blocked and counted;
- right-click "save image as" and dragging pictures are blocked on the stage and pictures (text fields keep their menu);
- the creator sees one short Hinglish notice, and the report goes to `/api/security` action `tamperReport`.

The server (`server/tamper-alerts.js`) stores each report in `securityAlerts` (kind, short detail, page, user agent, **hashed** IP, country), allows at most 6 per account per hour, ignores admins, and sends a push to admin devices at most once per 10 minutes per account. The Admin → Overview page shows the alerts with *Users kholein*, *Dekh liya* and *Sab dekh liye*, and pops a toast for a new alert while it is open.

An alert is a warning, not proof: ordinary people open the developer tools too. Decide in **Admin → Users** (restrict / block) and, if needed, in Firebase.

## Deploy checklist
1. Deploy (Vercel applies the new headers). Check the site still signs in with Google, opens Razorpay checkout and plays audio / exports.
2. Open the admin dashboard once, allow notifications on your admin device if you want push alerts.
3. `securityAlerts` is server-only: no change to Firestore rules is needed (they already deny unknown collections).
