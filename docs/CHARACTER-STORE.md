# Character Store (permanent rules)

An admin can sell a character for **Coins**. A buyer gets it for **30 days**, counted on the **server clock**. Dashboard → **Character Store** (`#/store`, `src/character-store.js`).

## The rules

- **30 days = 30 × 24 hours (720 h) exactly**, whatever the length of the month (`STORE_MS` in `shared/character-store.js`). Never a calendar month, never the phone's clock.
- The end time (`expiresAt`) is computed on the server from `Date.now()` in `server/character-store.js`. The store page shows "N days left" as `expiresAt − serverNow`, where `serverNow` comes from the server's answer and is moved on only by the time that passed on the device since (`skew`). A wrong phone clock changes nothing.
- A part of a day counts as a day (a purchase made now reads "30 days left"; below 2 days it shows days + hours, then hours, then minutes).
- Buying again while it is still running adds 30 days to the end, never more than 90 days ahead (`nextExpiry`). An ended purchase starts again from now.
- A double tap is charged once: the browser sends an `opId`; the server writes `characterSales/{uid}_{opId}` in the same transaction as the Coins and returns the first result for a repeated id.
- Price shown = price charged: the browser sends the price it showed; if it changed the server answers `price_changed` (409) and nothing is charged.

## Where things live

| What | Where |
|---|---|
| price and sale of a character | the character record in the Realtime Database: `store: { price: 1…100000, enabled }` (no `store` = free for everyone) |
| what an account has bought | Firestore `workspaces/{uid}/characterAccess/{characterId}` `{ purchasedAt, expiresAt, price, source: 'coins'|'admin' }` |
| every sale and gift (the admin's list) | Firestore `characterSales/{uid}_{opId}` |
| Coins spent | the normal Coin ledger (`kind: 'store_purchase'`, shown in the Coin history as "Character Store") |

Firestore rules need no change: there is no rule for these paths, so browsers cannot read or write them (only the server does).

## What a person gets (server: `server/characters-api.js`)

- `character:list` — free characters as before; paid characters the account has bought (and not ended) in full with `access.expiresAt`; paid characters on sale as a **locked card**: name, group, price, thumbnails and animation previews only (`lockedView`, `locked: true`); paid characters that are off sale are not listed unless the account owns them. Admins get everything.
- `character:files` — the rig, texture pages and animation files of a paid character are given **only** to buyers and admins (`allowedFiles`); thumbnails and previews of characters on sale are public. After the 30 days the files stop too. (The remembered library is 15 s old at most; a miss asks again with a fresh copy.)
- The studio picker (`src/catalog.js`) shows only what the account may use now. A saved project that uses a character whose time has ended says so ("…your 30 days have ended…") instead of failing silently; the character comes back when it is renewed.

## Admin (Admin → Characters)

- Upload: **Sell in the Character Store** + price. A re-upload keeps the old price unless the box is changed.
- Each saved character shows "Free for everyone" or "Store: N Coins"; **Store** opens price / on sale / free. Taking a character off sale or changing the price never takes it from people who already bought it.
- **Character Store sales** (loaded only when asked: the newest 100 sales and gifts) and **Give a character to an account** (30 days, by email, no Coins taken).

## Tests

`tests/character-store.test.js` (30-day math across months, price rules, locked cards, file gate, buying once, double tap, extension and the 90-day cap, expiry, admin price changes, sales, gifts) and `tests/browser/character-store.spec.js` (dashboard card, store page with a server clock 10 days ahead of the browser, buying, not enough Coins, previews, admin screens).
