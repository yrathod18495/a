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
