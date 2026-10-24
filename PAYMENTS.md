# Credit purchases

## Server keys

Add these environment variables to the server deployment. Never add the secret values to the browser build or commit them:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

The checkout can open when the key ID and key secret are configured. Enable automatic payment capture in Razorpay, then configure a webhook URL at `https://<your-domain>/api/razorpay-webhook` with the same webhook secret. Subscribe to `payment.captured`, `payment.authorized`, `payment.failed`, and `order.paid`. The webhook secret is needed for signed webhook updates; the checkout verification endpoint also checks the order signature and fetches the payment from Razorpay before it delivers credits.

The current maintenance setting blocks purchases for non-admin accounts. Set the existing server variable `MAINTENANCE_MODE=false` when the site is open for normal visitors; leave it enabled during maintenance.

The Firebase Admin service account used by the existing server APIs must have access to the configured Firestore database. Payment attempts are recorded in `creditPayments`; user scoped receipts are mirrored under `workspaces/{uid}/creditPayments`. The server alone can write either location and change `workspaces/{uid}.credits`.

## Packages

| Plan | Sale price | Displayed regular price | Credits |
| --- | ---: | ---: | ---: |
| Starter | ₹450 | ₹643 | 500 |
| Creator | ₹850 | ₹1,214 | 1,000 |
| Studio | ₹999 | ₹1,427 | 1,500 |

All displayed regular prices are calculated from the requested 30% discount. Amounts are fixed on the server in paise; client supplied prices are ignored.

## Credit usage

Purchase balances and receipts are stored and shown to the user and admins. The current AI tools call OpenRouter with the user’s own API key, so those tools do not spend this account credit balance yet. The Buy Credits page states this before checkout. Connect a server billed or otherwise credit metered feature before describing credits as spendable in existing tools.

## Export length limits (free and paid accounts)

One export (all scenes joined, or a single scene) is limited by the account tier:

| Tier | Longest single export |
| --- | ---: |
| Free (default) | 2 minutes |
| Paid | 10 minutes |

Limits live in `shared/export-limits.js` and are enforced by `api/export.js`; the studio asks the server before it renders anything.

### Data tree

- `entitlements/{uid}` – `{ tier: 'free' | 'paid', source, paidSince?, lastOrderId?, by?, updatedAt }`. Server-only writes; the owner may read it. A missing document is created on first use.
  - `source: 'purchase'` – set in the same transaction that credits a captured payment (`server/credit-payments.js`).
  - `source: 'purchase-backfill'` – an account that paid before tiers existed (Gold Coins above 0 or a captured payment) is recognised once and remembered.
  - `source: 'admin'` – set with `api/export.js` action `adminSetTier` (`{ uid, tier: 'free' | 'paid' }`, admin only, recorded in `securityAudit`). An explicit `free` revokes paid.
  - Admins export with the paid limit.
- `workspaces/{uid}/exports/{id}` – one row per export request: `{ tier, limitSeconds, seconds, scenes, scope, status: 'granted' | 'denied' | 'completed' | 'failed', createdAt, completedAt? }`. Denied attempts are kept, so abuse is visible. Server-only writes; the owner may read.
- The profile field `workspaces/{uid}.plan` is only a label the browser writes; it never decides a limit.

Deploy the updated `firebase/firestore.rules` (`firebase deploy --only firestore:rules`) so owners can read their own `entitlements` and `exports` rows. The export gate itself works without it, because it runs through the Admin SDK.

### Limits of this check

Videos are rendered in the user's browser, so the server can decide and record whether an export is allowed, but it cannot stop someone who modifies the page's code from rendering a longer video locally. Treat the limit as a product gate, not a security boundary. If the server cannot be reached, the free limit applies.
