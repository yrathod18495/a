# Error messages: always plain, professional English

**Rule (permanent, for every human and AI that changes this code):** every message a user can see about something that went wrong — toasts, form errors, empty/failed states, API error responses — and every other piece of user-facing copy in the app, is written in **plain, professional English**.

Not allowed: Hinglish/Hindi, raw English sentences copied from a library, stack traces, `FirebaseError: ...`, `permission-denied`, `Failed to fetch`, HTTP status text, or internal names shown on their own.

## How to write one

1. Say **what happened** in plain words, then **what the user can do next**.
2. Be polite and calm: use "please" / "try again". Never blame the user.
3. Keep it short (one or two sentences). No jargon, no codes, no file paths.
4. Money, security or data loss: reassure and give the next step ("If the amount was deducted, please contact support", "Your local work is safe").
5. Write plain, natural English sentences, no apostrophes inside single-quoted JS strings (use a straight apostrophe escaped, or restructure the sentence).

| Raw / library text (don't) | Plain English (do) |
| --- | --- |
| auth/popup-blocked | The browser blocked the sign-in popup. Please allow popups and try again. |
| Missing or insufficient permissions. | You do not have permission for this, or Firebase (Firestore) rules are blocking it. Please sign in again; if it still fails, ask an admin to check the Firestore rules. |
| Failed to fetch | There is a problem with your internet connection, or the server is not reachable right now. Please check your connection and try again. |
| Could not save: ${e.message} | Could not save: ${friendlyError(e)} |
| Payment verification failed. | Could not verify the payment. If the amount was deducted, please contact support. |
| Your video is 3 min long, but free accounts can export up to 2 min. | Your video is 3 min long, but a free account can only export up to 2 min at a time. Make the video shorter, or buy Gold Coins to export up to 10 min. |

## Where the code lives

- `shared/hinglish-errors.js` — `hinglishify(text)` and `friendlyError(error, fallback)`. The file and function names are legacy (from the earlier Hinglish-only policy) but are kept as-is since many call sites import them by these exact names; they now turn raw Firebase / Firestore rules / auth / network / quota / browser errors into plain English. Use them whenever you show `error.message` or an error you did not write yourself.
- `src/dom.js` `toast()` already runs every string through `hinglishify`, as a safety net. Do not rely on it for your own messages: write those in plain English at the place they are thrown.
- `src/session.js` `apiCall()` turns network failures into an English error with `code = 'network'`.
- Server: `AccessError(code, 'English message', status)` and `{ error: 'English message' }` in `api/*.js` and `server/*.js`.

## Do and don't

- **Do** keep machine-readable values in English: error `code` strings (`'invalid_plan'`, `'export_limit'`), HTTP statuses, log lines (`console.error`), field names, test ids. Log the technical detail to the console; show the plain English message to the user.
- **Do** show `friendlyError(e)` instead of a bare `e.message` when the error may come from a library.
- **Don't** compare against message text in code (`if (e.message === '...')`). Use `error.code` / `error.status`.
- **Don't** slip Hindi/Hinglish words back in "for now". `tests/hinglish-errors.test.js` scans `api/` and `server/` and fails on Hinglish/Hindi error messages.
- Normal labels, success messages and documentation text are not errors; they follow this same plain-English rule for anything user-facing.

## Checklist for a new feature

- [ ] Every new `throw` / `AccessError` / `toast` / error `<p>` that a user can reach is plain English.
- [ ] Library errors go through `friendlyError`.
- [ ] Error `code` stays English; tests assert on `code`, or on the exact English text when the text is the point.
- [ ] `node --experimental-test-module-mocks --test tests/*.test.js` passes (needs Node 24 for the server tests).
