# Instructions for AI coding agents

The permanent project rules are in `CLAUDE.md`. Read it before changing code. The two rules that are easiest to miss:

1. **DragonBones only.** The Spine runtime/library is never used; all rigs and animation data are DragonBones.
2. **Error messages are user-friendly Hinglish.** Anything a user can see that reports a problem is written in simple Hinglish (Roman Hindi with common English tech words), never raw English or raw Firebase / Firestore / browser text. Use `friendlyError()` / `hinglishify()` from `shared/hinglish-errors.js` for errors you did not write yourself, keep error `code`s and logs in English, and follow `docs/ERROR-MESSAGES.md`. `tests/hinglish-errors.test.js` enforces this for `api/` and `server/`.
