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

Tables: `booking_settings`, `flight_alerts`, `companies`, `users`, `clients`, `rides`, `sessions`, `memberships`, `drivers`, `invites`, `invoice_settings`, `invoices`, `rate_sheets`, `ride_requests`, `booking_pages`, `booking_limits`, `driver_locations`, `location_links`, `sms_messages`, `stripe_events`, `admin_audit`, `login_attempts`, `static_assets`.

`drivers` is the fleet roster (name, vehicle type, plate, passcode hash, `deleted_at`) and points at the driver user. Rides still store that user id in `rides.driver_user_id`. Renaming a driver updates the roster name only. A fleet owner adds, edits, and removes drivers from More, then sets the passcode on that screen. Removing a driver sets `deleted_at`, clears the passcode, and ends their sessions. Upcoming rides (not completed or cancelled) become unassigned. Completed and cancelled rides keep the driver id, so the name stays on those records. The driver signs in with the company code, their name, and the passcode. Older driver accounts that were invited by email still sign in with email and a password until they are removed.

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
| `PLACES_AUTOCOMPLETE` | plain text | `on` shows address suggestions on the booking page through the Worker (`/api/public/book/<slug>/places`, Places API (New) on `GOOGLE_MAPS_SERVER_KEY`). Default off. The key needs Places API (New) enabled |
| `FLIGHT_DATA_PROVIDER` | plain text | `aeroapi` (FlightAware AeroAPI) turns on flight alerts for airport pickups. Default off |
| `FLIGHT_DATA_API_KEY` | secret | AeroAPI key. Unset means no flight lookups |
| `STRIPE_SECRET_KEY` | secret | Stripe test key only. Live keys are refused |
| `STRIPE_WEBHOOK_SECRET` | secret | Stripe webhook signing secret |
| `STRIPE_PORTAL_CONFIGURATION` | plain text | Stripe customer portal configuration id |
| `BLAND_API_BASE` | optional | Local mock only (`http://127.0.0.1:<port>`) |
| `STRIPE_API_BASE` | optional | Local mock only (`http://127.0.0.1:<port>`) |

## Airport bookings, vehicles, and flight alerts

Each fleet sets these in Rates (owner only), stored in `booking_settings`:

- **Airports.** "Use the ATL terminals" loads the example config from `app/airport-booking.js` (`AIRPORT_PRESETS.ATL`): Domestic Terminal North, Domestic Terminal South (Delta), International Terminal; black SUV pickups meet at the Legacy West Curb (W1 and W2) with inside meet-and-greet as the other choice; drop-offs are topside or curbside, topside by default for SUVs, same fare. With no airports set the booking page has no airport connection.
- **Airport side.** "Airport connection" decides which end is the terminal dropdown. The other end is always a typed address. Quote links and place chips never write the airport into the other end.
- **Field order.** Trip type, airport connection, pickup, meeting point, date and time, flight number (tracking only; the pickup time the client picks is the pickup time), passengers and luggage, drop-off, quote (only once both ends are filled), vehicle, contact, review, submit.
- **Vehicles.** Rate-sheet vehicles whose type the roster doesn't run are hidden (an SUV-only roster hides Sedan). With no vehicle types on the roster, every rate-sheet vehicle is offered. Passenger limits per vehicle type: sedan 3 by default. Only vehicles that seat everyone are listed, and the server rejects a vehicle that is too small.
- **Flight alerts.** A cron (`*/5 * * * *`) checks airport pickups with a flight number from 6 hours before to 3 hours after pickup and records alerts the assigned driver sees on the ride: cancelled, diverted, delayed over 30 minutes, early by 15 minutes or more (owner can set 15 to 30), and any other change (new time, terminal, gate, departed, landed). The ride's pickup time is never changed. Drivers have no phone number on the roster, so alerts are in the app only.

Quote or website links can prefill the booking page: `/book/<slug>?airport=pickup&code=ATL&spot=domestic-south&dropoff=...` (`airport` also accepts `from_atl` / `to_atl`).

## Booking deploy gate

`scripts/predeploy-e2e.sh` (CI job `booking-walkthrough`) runs real client journeys at 390px and 1024px on a local Worker with a throwaway D1: quote links with the airport prefilled, switching the airport connection both ways, the passenger and vehicle rules, through review. It blocks any real submit. `scripts/deploy-prod.sh` refuses to deploy unless `npm run check` and that walkthrough passed on the same clean commit, and `NUDGE_DEPLOY_CONFIRM=yes` is set. It never applies D1 migrations.
