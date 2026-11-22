# Copilot review instructions: Nudge Dispatch

Nudge Dispatch is a multi-fleet dispatch and booking app for small car-service fleets, running as the Cloudflare Worker `nudge-app` with a D1 database. Changes usually come from Claude, and Devo (the release agent) tests and ships them. Jesse (the owner) approves every deploy. Review as a second pair of eyes, and focus on real bugs and risks, not style preferences.

## Flag as blocking

- **Secrets in the diff.** API keys, tokens, webhook secrets, passcodes, `.dev.vars` values, or real-looking keys in code, tests, comments or docs. Placeholders like `YOUR_KEY_HERE` are fine.
- **Server-only keys reaching the browser.** `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_ROUTES_KEY`, Stripe, Bland, AeroAPI, VAPID private key and similar must never appear in HTML, client JS, `/api/me` or any response body.
- **Cross-tenant data.** Every owner or driver query must be scoped to the caller's `company_id`. Drivers must get 403 on owner-only actions.
- **Migrations.** Migrations in `migrations/` are additive only: new numbered files, never edits to an existing one. Flag destructive SQL (DROP, DELETE without a tight WHERE, column removal).
- **Live side effects.** Code or config that sets `SMS_MODE` to `live`/`test`, sets `STRIPE_MODE=live`, points `wrangler.toml` at a production D1 id, or runs `wrangler deploy` / remote D1 commands outside `scripts/deploy-prod.sh`.
- **Money.** Fare, quote, trial and billing math in `app/quote-engine.js`, `app/billing.js`, `app/trial.js`, `app/stripe_webhook.js`, `app/paypal.js`: rounding to cents, minimums, airport and extra-stop fees, round-trip factors, and the "Price needed" path when no automatic price exists. A client must never be shown or charged a wrong price silently.
- **Security headers.** The strict CSP and `no-referrer` on `/` and `/index.html` must not be loosened. Looser booking CSP belongs only on `/book/<slug>/`.
- **CSRF and auth.** New signed-in POST endpoints need the existing session and CSRF checks. Public endpoints need rate limits or daily caps (see `ROUTES_*_CAP`, `FLIGHT_*_CAP`).

## Also check

- Tests in `test/` cover new behavior, and `npm run check` (lint, typecheck, tests, build) would pass.
- Booking-page changes keep the client journey in `scripts/predeploy-e2e.sh` working at 390px and 1024px.
- Times use America/New_York for "today", daily caps and schedules.
- External calls (Google Routes/Places, flight data, Stripe, Bland) have timeouts and fail closed with a clear message instead of a wrong price.
- `APP_README.md` is updated when env vars, secrets or behavior change.

## Scope

Only this repo (`nudgedispatch/nudgedispatch`). Iron Gate code (`nudgedispatch/irongate`) and the marketing site Worker are separate: flag changes that try to reach into them.

Keep comments short and concrete: file, line, what breaks, and a suggested fix.
