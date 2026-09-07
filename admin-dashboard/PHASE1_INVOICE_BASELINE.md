# Phase 1 — Invoice series baseline

Recorded **05 Sep 2026**, immediately before issue-gating and transactional
allocation were deployed. Everything at or below these values was issued by the
old, non-transactional, preview-allocating code path. Everything above them was
issued by the new path.

| Series | Counter document | Field | Value at cutover |
|---|---|---|---|
| Customer invoices | `counters/invoices` | `lastNumber` | **136** |
| Commission invoices | `counters/commissionInvoices` | `count` | **71** |

The next customer invoice issued is `INV-2026-000137`; the next commission
invoice takes sequence `72`.

## Why this matters

Under the old code a serial was consumed the moment anyone *opened* an invoice
preview, and the counter was read, incremented and re-read in three separate
round trips. So within 1–136 expect:

- **gaps** — serials handed to a preview that was closed without downloading
- **duplicates** — two requests that read the same counter value concurrently

Neither can occur above the cutover. Both need to be catalogued and explained
before the affected periods are treated as final, which is Phase 4.

## Produce the gap register

```bash
cd admin-dashboard
node scripts/invoice-series-audit.js            # summary
node scripts/invoice-series-audit.js --verbose  # every gap and duplicate listed
```

Read-only — it writes nothing and is safe against production. It needs
`.env.local` with `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
`FIREBASE_PRIVATE_KEY`, and network access to `firestore.googleapis.com`.

Keep the output. A documented gap is defensible in an audit; an unexplained one
is not.

## What Phase 1 changed

| Finding | Change |
|---|---|
| F-01 duplicate serials | Allocation moved into `db.runTransaction`; counter and invoice record written together, so a failed write cannot leave a hole. Corrupt counter now throws instead of restarting at 1. |
| F-02 previews burn serials | `GET /api/invoices/[orderId]` allocates only when `format=pdf` or `issue=true`. Previews return a draft with no number; the modal shows "Draft — number issued on download". |
| F-05 unverified API access | All 57 non-public route handlers wrapped in `withAdmin()`, which verifies the Firebase ID token in the Node runtime and confirms admin authorisation. 401 for a bad token, 403 for a verified non-admin. |
| F-06 (partial) | The invoice now prints the date its serial was issued, not the date of the current render. Full document immutability is Phase 2. |

`counters/invoices` keeps the field name `lastNumber` and
`counters/commissionInvoices` keeps `count`, so no data migration was needed.

## Admin authorisation

`requireAdmin()` in `src/lib/api-auth.ts` authorises a verified user by, in order:

1. a custom claim `admin: true` on the token,
2. a document in the `admins` collection (what `scripts/create-admin.ts` writes),
3. the `ADMIN_EMAILS` environment allowlist (comma-separated).

**Bootstrap safety.** If the `admins` collection is empty *and* `ADMIN_EMAILS`
is unset, any verified user is let through and a `[API Auth] BOOTSTRAP` line is
logged on every request. This exists only so that turning authorisation on could
not lock the sole admin out of the panel. It closes itself permanently as soon
as one admin document exists.

Confirm it is closed:

```bash
# Should print at least one admin. If it prints none, provision one now.
npx ts-node scripts/create-admin.ts <email> <password> "Name"
```

Then watch the deployment logs for `[API Auth] BOOTSTRAP` — it should never
appear. If it does, no admin is provisioned and the panel is open to any
signed-in Firebase user in this project, including customers of the Android app.

## Routes deliberately left public

Not wrapped, because they are called by the Android customer app or by Razorpay
and authenticate by other means:

- `/api/webhooks/razorpay` — webhook signature
- `/api/payments/create-order` — called from `PaymentManager.kt`
- `/api/payments/verify` — called from `PaymentManager.kt`

`/api/payments/verify` accepting unauthenticated requests deserves its own
review; changing it requires a coordinated app release, so it was left alone in
Phase 1 rather than broken silently.

## Rollback

This folder is not tracked by the PLATOOS repo — `.gitignore` excludes
`admin-dashboard/`, and it is published to
`github.com/delito-food/Admin-panel` by `push-to-admin-panel.ps1`. So the
previous version lives in that repo's history, and locally in two backup copies
kept beside the originals:

- `src/lib/api-auth.ts.bak`
- `src/middleware.ts.bak`

Delete them once the deploy is confirmed good.

To relax admin *authorisation* without giving up token *verification*, set
`ADMIN_EMAILS` to the addresses that should keep access — do not remove the
`withAdmin()` wrappers.

## Deploying

```powershell
powershell -ExecutionPolicy Bypass -File .\push-to-admin-panel.ps1
```

Verify `npx tsc --noEmit` and `npm run build` pass on Windows first — the
build could not be run during implementation because `node_modules` holds the
Windows SWC binary and the sandbox had no network to fetch a Linux one.
`tsc --noEmit` passed clean, and `typecheck/route-contracts.ts` asserts every
wrapped handler still matches Next's route signature.
