# Nudge Dispatch app

This file is the app guide. The repository root `README.md` is the public GitHub profile page and is left unchanged.

Canonical repository: [nudgedispatch/nudgedispatch](https://github.com/nudgedispatch/nudgedispatch).

## What is in this tree

The Worker in `app/` is the operator app recovered from the deployed Cloudflare Worker `nudge-app` (version 29, uploaded 2026-11-10). `app/index.js` is that Worker's esbuild bundle. The other files under `app/` are the modules it imports (shell, quote engine, trial, billing access, Stripe test-mode helpers, and the Bland texting module).

The private repository `nudgedispatch/Nudge-Dispatch-` was not readable from this environment. Its installation token can see only this public repository, so the unmerged branches were not fetched as git history. The deployed Worker is the combined app those branches grew into, plus trial and Stripe test-mode billing that landed after the 2026-11-09 handoff. The Iron Gate CRM port (`cursor/crm-on-stack-146d`, `cursor/crm-d1-146d`) is not in this Worker. The Iron Gate CRM Worker, its Apps Script, and the Iron Gate D1 database are not part of this tree.

## Local run

Requirements: Node 22.

```bash
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply nudge-app-local --local
node scripts/seed-local.js
npm run dev
```

`.dev.vars` is gitignored. Leave `PLATFORM_ADMIN_EMAILS` empty unless you are testing a local platform admin.

Open http://127.0.0.1:8787 . The seed script prints two sample logins. They exist only in the local D1 database under `.wrangler/`.

`SMS_MODE` is `off` in `wrangler.toml`. The app will not send texts. Do not set `SMS_MODE` to `live` or `test` unless you intend to. Do not run `wrangler deploy` from this checkout. `wrangler.toml` points at a placeholder local database id, not production.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run build` bundles with `wrangler deploy --dry-run` and does not upload.

## Data stores

The operator app reads and writes Cloudflare D1 through the `DB` binding.

| | |
|---|---|
| Production database name | `nudge-app-db` |
| Local name in this repo | `nudge-app-local` |

Tables: `companies`, `users`, `clients`, `rides`, `sessions`, `memberships`, `drivers`, `invites`, `invoice_settings`, `invoices`, `rate_sheets`, `ride_requests`, `booking_pages`, `booking_limits`, `driver_locations`, `location_links`, `sms_messages`, `stripe_events`, `admin_audit`, `login_attempts`, `static_assets`.

`drivers` is the fleet roster (name, vehicle type, plate, passcode hash) and points at the driver user. Rides still store that user id in `rides.driver_user_id`. Renaming a driver updates the roster name only. A fleet owner adds and edits drivers from More, then sets the passcode on that screen. The driver signs in with the company code, their name, and the passcode. Older driver accounts that were invited by email still sign in with email and a password.

This app does not read or write Google Sheets. CSV export is a file download. Distance quotes, when a key is configured, call the Google Routes API (`routes.googleapis.com`), not Sheets. The Iron Gate CRM spreadsheet is a separate system and is not connected here.

## Environment and secrets

Set these on the Worker host. Do not commit values.

| Name | Kind | Role |
|---|---|---|
| `DB` | D1 binding | All operator data |
| `ADMIN_TOKEN` | secret | Bearer token for the non-UI admin API. Empty hides that API |
| `PLATFORM_ADMIN_EMAILS` | secret | Comma-separated emails allowed to be platform admins. Unset or empty means nobody is a platform admin, including accounts already flagged in D1. Set this on the `nudge-app` Worker before the next deploy |
| `BLAND_API_KEY` | secret | Bland SMS. Unused while `SMS_MODE` is `off` |
| `BLAND_FROM_NUMBER` | plain text | Bland sending number |
| `SMS_MODE` | plain text | `off` (default here), `test`, or `live` |
| `SMS_TEST_ALLOWLIST` | plain text | Comma-separated +1 numbers used only when `SMS_MODE` is `test` |
| `GOOGLE_MAPS_SERVER_KEY` | secret | Google Routes API for distance quotes. Omit to skip distance lookup |
| `STRIPE_SECRET_KEY` | secret | Stripe test key only. Live keys are refused |
| `STRIPE_WEBHOOK_SECRET` | secret | Stripe webhook signing secret |
| `STRIPE_PORTAL_CONFIGURATION` | plain text | Stripe customer portal configuration id |
| `BLAND_API_BASE` | optional | Local mock only (`http://127.0.0.1:<port>`) |
| `STRIPE_API_BASE` | optional | Local mock only (`http://127.0.0.1:<port>`) |
