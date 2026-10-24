# Character files

Ready-to-upload zips are in `public/characters/` (served at `/characters/<name>.zip` after deploy).
Raw files on the platform CDN (https://assets.stpro.app/):

## Mool Chand — 3-4 Front Sitting Cross-Legged
- rig: https://assets.stpro.app/assets/Characters/d3f1cba2ff9d4e09942260034c5b7c42.json
- atlas: https://assets.stpro.app/assets/Characters/2479de4b98f44287b7c8886077d9534d.atlas
- texture: https://assets.stpro.app/assets/Characters/48f3ad748da646a9b04c23ff51bb84c4.webp
- texture: https://assets.stpro.app/assets/Characters/6ba29aea72764a74939410f20ff6acb8.webp

## Mool Chand Suit — 3-4 Front
- rig: https://assets.stpro.app/assets/Characters/a955da44ec324e0b9840ef241407e6be.json
- atlas: https://assets.stpro.app/assets/Characters/46274101736e44f2a0ee9767304d7119.atlas
- texture: https://assets.stpro.app/assets/Characters/9b1c4702764f430582eec7a09024685b.webp

## Kundan — 3-4 Back
- rig: https://assets.stpro.app/assets/Characters/4046070ce91b46ad8dfbaaedaf93656f.json
- atlas: https://assets.stpro.app/assets/Characters/f0375125415b4778a2ea4cfca95b7381.atlas
- texture: https://assets.stpro.app/assets/Characters/46ae29e740fa4135bfba93fe28744b31.webp

## Blazer — 3-4 Front
- rig: https://assets.stpro.app/assets/Characters/db0da6a0-4d9f-4f36-a6fd-caa98a7cf7ad.json
- atlas: https://assets.stpro.app/assets/Characters/7ce0f45d-4052-4945-b0f5-8439bb6d03e4.atlas
- texture: https://assets.stpro.app/assets/Characters/5d728ddd-6581-4874-84bb-4ac5b00e9054_1.webp

## Blazer — Back
- rig: https://assets.stpro.app/assets/Characters/22de0795-aa76-4d0a-97b7-85f99ad04f10.json
- atlas: https://assets.stpro.app/assets/Characters/79bc039a-9c38-4d53-aa44-223aa992eb18.atlas
- texture: https://assets.stpro.app/assets/Characters/c11f9544-6033-44e3-b9e4-2e0a5b222f9c_1.webp

## Blazer — Front
- rig: https://assets.stpro.app/assets/Characters/c17ef1bc-edeb-4b48-80df-4baf65333509.json
- atlas: https://assets.stpro.app/assets/Characters/50fb0407-722d-4b5d-a2ca-13a8a94aa4b5.atlas
- texture: https://assets.stpro.app/assets/Characters/d002f7db-9749-49de-b439-9125dac03f7d_1.webp

## Blazer — Side
- rig: https://assets.stpro.app/assets/Characters/6646ea3c-90b3-4677-a7dc-5c5098215739.json
- atlas: https://assets.stpro.app/assets/Characters/6a1e1598-b67d-4792-bc46-7030bbff9d64.atlas
- texture: https://assets.stpro.app/assets/Characters/5576d96d-d7f8-46a8-8312-cdcfa7cf1f0a_1.webp


Other front characters (Kundan, Roshan, Maharaja Devender, Aghornath, Shanta, Muslim Man …) need `STPRO_TOKEN=<token> node scripts/sync-catalog.mjs --live && node scripts/make-character-zips.mjs` to resolve their links.
