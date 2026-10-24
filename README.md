# 12toons

> **Rule: DragonBones only.** The Spine library is not used. All rigs and animation data are DragonBones, and all code uses only the DragonBones runtime. See `CLAUDE.md`. Spine files live in `sources/spine/` and are only the input of `scripts/build-db-data.py`.

AI animation studio that runs in the browser.

- **12toons** – animation workbench: characters, backgrounds, audio lines (ZIP, optional) → AI direction → camera → export (WebM / MP4, up to 4K).
- **12toons Character Studio** – start from a template (Neha / My Baby, 5 poses each) or any DragonBones character ZIP (skeleton `_ske.json` + texture `_tex.json` + picture); every layer can be uploaded (png / svg), downloaded, removed, locked, recoloured and nudged; face fitting (eyes, brows, nose, lips, ears); outfits; live preview with animations and mouth test. Save = baked character in this device's database and in your account (Firestore + R2); the animation studio loads exactly that character.
- **Autodraft data** (see `scripts/README-autodraft.md`): two template characters, 700+ animations in four tracks (body, hands, legs, face layers) with previews.
- **Auto-direct with any AI (no key):** step 2 / AI tab → *Download brief (.txt)* → give it to Claude / ChatGPT / Gemini → *Import AI file*. The AI picks shot, who is on screen and which animation plays at which second for every dialogue.
- Flow: landing page → Google login → hub (choose one of the two tools).
- Theme: white background, blue accents, black + blue buttons.

## Run
```
npm install
npm run dev       # http://localhost:5173  (add ?debug to skip the login while testing)
npm run build
```

## Accounts, projects and cloud

Both studios now open My Projects. Drafts are saved in account/project-scoped IndexedDB and automatically synchronized through authenticated backend APIs. See [Security rollout](docs/SECURITY-ROLLOUT.md) before deploying: Firebase Admin credentials, server-managed sessions and matching Firestore rules are required for production login.

## Autodraft animations
The animation library of the Autodraft characters (Neha, My Baby) is built by `python3 scripts/convert-stpro-anims.py` (own names; body / hand / leg / face-expression tracks per pose). Neck + head sway gently on their own in every pose.

## Admin panel (hide / show animations)
Open **Hub → 🛠 Admin panel** (`#/admin`). Pick a character and a pose, preview any animation live on that character, then switch it on or off
(for that character, or for every character) and press **Publish to users**. Users no longer see hidden animations in the pickers, the AI brief and the
Character Studio preview (animations already placed in an existing project keep playing).

- Admin access is checked by the backend using an enabled securityAdmins/{uid} document. Email lists and VITE_ADMIN_OPEN no longer grant access.
- Users & Security provides account moderation, session revocation, device review and audit history.
- The debug login is available only in the Vite development server.

## Timeline clips + camera keyframes (animation studio)
- **Animations, as many as you like:** every character has its own lane under the audio. Press ＋ on the lane (or tick "Add on the timeline at the playhead" in the Animations tab) to place an animation at the playhead — the same one again too. Drag a clip to move it, drag its right edge to stretch (it loops), or use Duplicate / Split / Replace / Delete in the bar above the timeline. Your clips win over the automatic ones (the automatic clips are cut around them). Hand / legs / face layers get their own rows. In a scene without audio the length grows with your clips.
- **Camera keyframes:** the Camera tab (and the 🎥 lane). Move the playhead and drag the orange frame on the stage (corners = zoom): a keyframe is made there. Each key has zoom, position and how it moves to the next key (smooth / even / slow start / slow end / cut). The editor shows the whole canvas with the frame; only what the camera sees is rendered into the video ("Camera view" previews it). No keys = the automatic shots per audio line as before. Camera roll (tilt) is not supported.
- **Character keyframes** (🏃 Move tab and a ◆ lane under the character): keyframes for position, height, size and facing. Press ＋ Keyframe here, move the playhead, then drag / resize the character on the stage (a keyframe is made automatically) — the character glides between keyframes (smooth / even / slow start / slow end / jump). Camera and character keyframes are independent.
- **Canvas size:** 9:16, 16:9, 1:1, 4:5, 3:4, 4:3, 21:9 or any custom ratio (Camera tab).
- Characters and poses: Character Studio and the character picker show a full-body picture per pose (`public/autodraft/pose/`).

- **Layers page** (🧩 in the admin panel): rename any Character Studio layer or group and switch layers on / off for users (for one character or all). Off = the layer is not in the users' list (the picture stays on the character). Stored in Firestore `config/layers`; the layer size line (`174×405`) is no longer shown in the Character Studio.

## Tester page
For people who test characters. In the admin panel → **🧪 Testers**: add their e-mails, choose how many animations they get and tick which ones (Walk · run · idle · talk is a quick preset). A tester who logs in with a listed e-mail sees **only** the tester page (`#/tester`): no home, studio or Character Studio. Admins can open it from the hub (🧪 Tester page).
On the tester page: pick a template (or add a character ZIP), upload the layers (⬆ Upload layers, or one by one), tune the **face** (eyes, brows, nose, lips, ears: up / down, left / right, distance, size, tilt), play the allowed animations to check it, then **Save**. The character, its layers and all face settings are saved in the database (Firestore `testerCharacters` + the tester's cloud folder) and every animation then plays on exactly that data.
Admins see what testers saved at the bottom of 🧪 Testers (the picture files stay in the tester's own cloud folder).

## Video without voice
Export works with no audio at all: the video is 8 seconds and silent (no audio track). With audio, the length follows the voice as before.

## Where things are
- `src/shell.js` – landing, login, hub, routing (`#/`, `#/login`, `#/hub`, `#/toons`, `#/characters`)
- `src/main.js` – the 12toons animation studio · `src/stage.js` – renderer · `src/lipsync.js`, `src/exporter.js`
- `src/charstudio.js` – Character Studio · `src/ai.js` – OpenRouter AI director (key stays in the browser)
- `src/firebase.js`, `src/cloud.js`, `api/r2.js` – login, Firestore, R2 sync
- `HANDOFF.md` – architecture notes
