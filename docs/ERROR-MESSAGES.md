# Error messages: always user-friendly Hinglish

**Rule (permanent, for every human and AI that changes this code):** every message a user can see about something that went wrong — toasts, form errors, empty/failed states, API error responses — is written in **simple Hinglish**: Roman-script Hindi with the common English tech words people already use (sign in, account, file, project, upload, export, server, internet, payment).

Not Hinglish, not allowed: raw English sentences, stack traces, `FirebaseError: ...`, `permission-denied`, `Failed to fetch`, HTTP status text, or internal names shown on their own.

## How to write one

1. Say **what happened** in plain words, then **what the user can do next**.
2. Be polite and calm: use "aap" / "karein" / "dobara try karein". Never blame the user.
3. Keep it short (one or two sentences). No jargon, no codes, no file paths.
4. Money, security or data loss: reassure and give the next step ("Agar paisa kat gaya hai to support se sampark karein", "Aapka local kaam safe hai").
5. Write Roman Hindi only (no Devanagari), no apostrophes inside single-quoted JS strings.

| English (don't) | Hinglish (do) |
| --- | --- |
| Verified sign-in required. | Pehle verified account se sign in karein. |
| Missing or insufficient permissions. | Aapko is kaam ki permission nahi hai, ya Firebase (Firestore) rules is kaam ko rok rahe hain. Dobara sign in karke dekhein; phir bhi na chale to admin se Firestore rules check karwayein. |
| Failed to fetch | Internet connection me dikkat hai ya server abhi nahi mil raha. Connection check karke dobara try karein. |
| Could not save: ${e.message} | Save nahi ho paya: ${friendlyError(e)} |
| Payment verification failed. | Payment verify nahi ho paya. Agar paisa kat gaya hai to support se sampark karein. |
| Your video is 3 min long, but free accounts can export up to 2 min. | Aapka video 3 min lamba hai, lekin free account se ek baar me sirf 2 min tak ka video export ho sakta hai. Video chhota karein, ya credits kharidkar 10 min tak export karein. |

## Where the code lives

- `shared/hinglish-errors.js` — `hinglishify(text)` and `friendlyError(error, fallback)`. They turn raw Firebase / Firestore rules / auth / network / quota / browser errors into Hinglish. Use them whenever you show `error.message` or an error you did not write yourself.
- `src/dom.js` `toast()` already runs every string through `hinglishify`, as a safety net. Do not rely on it for your own messages: write those in Hinglish at the place they are thrown.
- `src/session.js` `apiCall()` turns network failures into a Hinglish error with `code = 'network'`.
- Server: `AccessError(code, 'Hinglish message', status)` and `{ error: 'Hinglish message' }` in `api/*.js` and `server/*.js`.

## Do and don't

- **Do** keep machine-readable values in English: error `code` strings (`'invalid_plan'`, `'export_limit'`), HTTP statuses, log lines (`console.error`), field names, test ids. Log the technical detail to the console; show Hinglish to the user.
- **Do** show `friendlyError(e)` instead of a bare `e.message` when the error may come from a library.
- **Don't** compare against message text in code (`if (e.message === '...')`). Use `error.code` / `error.status`.
- **Don't** add an English message "for now". `tests/hinglish-errors.test.js` scans `api/` and `server/` and fails on English error messages.
- Normal labels, success messages and documentation text are not errors; they follow the page's own language.

## Checklist for a new feature

- [ ] Every new `throw` / `AccessError` / `toast` / error `<p>` that a user can reach is Hinglish.
- [ ] Library errors go through `friendlyError`.
- [ ] Error `code` stays English; tests assert on `code`, or on the Hinglish text when the text is the point.
- [ ] `node --experimental-test-module-mocks --test tests/*.test.js` passes (needs Node 24 for the server tests).
