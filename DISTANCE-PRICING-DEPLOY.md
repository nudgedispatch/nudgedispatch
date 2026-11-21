# Distance pricing, airports and location bias: deploy checklist (Nudge Dispatch)

Branch `distance-pricing`, Nov 20, 2026. For Devo. **Nothing goes live without Jesse's explicit OK.**
Iron Gate is not in this change (its booking app has no source in the repo; see the end).

## What changed

| Area | Files |
| --- | --- |
| Fare formula (pure) | `app/fare.js`, tests `test/fare.test.js` |
| Airport list we maintain (ATL, CLT, BNA) | `app/airports-data.js` |
| Flight provider interface (AeroAPI built; AeroDataBox and Cirium stubbed) | `app/flight-provider.js`, `app/flight-alerts.js` (re-exports) |
| Quote engine: distance path, legacy path kept | `app/quote-engine.js` |
| Routes call, caps, flight-status endpoint, quote snapshot, fleet base, CSP | `app/index.js` |
| Airport presets from the list, terminal source | `app/airport-booking.js` |
| Booking page: Places suggestions, stops priced, airport/flight/airline, manual-price copy | `app/client-book.txt`, `app/book.html` |
| Owner app: rate form, airports tick-boxes, home base, Price needed, prefilled approve, landing/free wait, address suggestions | `app/client-app.txt`, `app/app.css` |
| D1 migration | `migrations/0019_distance_pricing.sql` |
| Config placeholders | `wrangler.toml`, `.dev.vars.example` |
| Tests and screenshots | `test/distance-pricing-api.test.js`, `scripts/e2e/distance-shots.mjs` |

How existing fleets behave: a fleet keeps its current quotes (flat fares, per-vehicle mileage) **until the
owner saves the new rate form** in More > Rates. From then on, one-way and round-trip trips use the distance rates.
Hourly does not change. Every rate sheet is copied to `rate_sheets_legacy` by the migration.

## 1. Google Cloud

The brief names project `iron-gate-maps` for both apps. Nudge's Google calls would then bill to
Iron Gate's project. Confirm with Jesse before you go ahead; a separate Nudge project is cleaner.

Enable these APIs:
- [ ] **Routes API** (server: `computeRoutes`)
- [ ] **Places API (New)** (browser suggestions)
- [ ] **Maps JavaScript API**: needed to load the Places library in the browser. The brief did not list it.

Create two keys:
- [ ] **Browser key** (public, ends up in the page):
  - Application restriction: HTTP referrers `https://nudgedispatch.com/*` and `https://*.nudgedispatch.com/*`.
  - API restriction: Maps JavaScript API and Places API (New) only.
- [ ] **Server key** (secret):
  - API restriction: Routes API only.
  - No application restriction (Workers have no fixed IP). Never put it in a page, log or doc.
- [ ] Optional second guard: set per-day quotas on both APIs in the Cloud console, a little above our own caps.

## 2. Worker secrets and variables (`nudge-app`)

```bash
npx wrangler secret put GOOGLE_ROUTES_KEY      # server key (paste YOUR_KEY_HERE when prompted)
npx wrangler secret put FLIGHT_API_KEY         # flight provider key
```

| Name | Kind | Value |
| --- | --- | --- |
| `GOOGLE_ROUTES_KEY` | secret | Server key (falls back to `GOOGLE_MAPS_SERVER_KEY` if unset). Without either key, one-way and round-trip requests arrive as **manual** ("We'll confirm your price shortly"). |
| `GOOGLE_MAPS_BROWSER_KEY` | var | Browser key. Empty means plain address fields everywhere. |
| `ROUTES_DAILY_CAP` | var | Default `500` (all fleets together, per Eastern day). There is also a 500/day/fleet limit. |
| `FLIGHT_PROVIDER` | var | `aeroapi` (the only adapter built), or `off`. |
| `FLIGHT_API_KEY` | secret | AeroAPI key. |
| `FLIGHT_DAILY_CAP` | var | Default `200`. Counts booking-page lookups only. The 5-minute flight-alert cron is not counted. |

- [ ] **Routing key:** prefer `GOOGLE_ROUTES_KEY`. If it is unset, routing falls back to `GOOGLE_MAPS_SERVER_KEY`, so a live
  fleet that already has the older secret keeps road-distance quotes. Still set `GOOGLE_ROUTES_KEY` when you can (restrict it to the Routes API).
- [ ] **Old flight names:** `FLIGHT_DATA_PROVIDER` / `FLIGHT_DATA_API_KEY` are still read when the new names are unset. Remove them once the
  new ones are in.
- [ ] **Keep everything else:** `ADMIN_TOKEN` and every other secret and binding stay as they are. No Cloudflare rules change.

## 3. Database

- [ ] Apply `migrations/0019_distance_pricing.sql` to `nudge-app-db` the usual way (the same flow as 0018). It is additive:
  - a `rate_sheets_legacy` copy
  - five new `rides` columns
  - the `api_daily_usage` table
  - four `companies` base columns
- [ ] Deploy the Worker **after** the migration. Without the usage table the caps fail closed, so routing goes to manual.

## 4. Security headers (please review)

These apply only to the **booking page and the owner/driver app shell**, and only when `GOOGLE_MAPS_BROWSER_KEY` is set:
- **CSP:** Google's documented allowlist for the Maps JavaScript API (`CSP_BOOK_MAPS` in `app/index.js`). It includes `'unsafe-eval'` and `'unsafe-inline'` styles, as Google's allowlist requires.
- **Referrer policy:** `strict-origin-when-cross-origin` instead of `no-referrer`, so the referrer-restricted key is accepted. Only the page origin is sent.

Every other response keeps the strict CSP and `no-referrer`. This is app code, not a Cloudflare rule, but it does loosen
the logged-in app when the key is on.

## 5. Data still to fill in (`app/airports-data.js`, all marked `TODO`)

- [ ] **ATL curb pins** (`curb: { lat, lng }`) for Domestic North, Domestic South and International. Until they are set, routing uses
  each terminal's address, so International and Domestic already route to different points. The pins make it exact.
- [ ] **ATL airline exceptions:** any airline other than Delta that does not use Domestic North (for example international carriers). Ask Jesse.
- [ ] **CLT and BNA:** real terminal names, curb pins and airline tables. They ship as one "Main terminal (TODO: verify)" entry each,
  with empty airline tables, so the rider picks the terminal.
- [ ] **Provider terminal codes** (`providerCodes`, e.g. ATL `N` / `S` / `I`, `F`): check them against real AeroAPI responses.
- [ ] **Airport centers:** approximate, used only to recognise an autocomplete pick of type `airport`. Confirm them.
- [ ] **AeroDataBox / Cirium:** if Jesse picks one of these, implement `fetch()` in `app/flight-provider.js`.

## 6. Manual test script (staging, after Jesse's OK to stage)

Setup:
- One fleet with the distance rates base $10, per mile $3, minimum $65, airport fee $15 and stop fee $10.
- One SUV at $75/h, 3 h minimum, then $18.75 per 15 min.
- ATL ticked in More > Rates.
- Home base set to an Alpharetta address picked from the suggestions, radius 50 mi.

1. **Normal trip:** pick both addresses from the suggestions.
   - Expect "About $X". The breakdown shows miles (1 decimal) and minutes.
   - Approve: the box is prefilled with the quote. The invoice, including PayPal, shows the same amount.
2. **Two stops:** add 2 stops. Expect a higher mileage and a "2 stops x $10" line.
3. **Airport pickup with a flight number:** Pickup at ATL, flight `DL1234`.
   - Expect the terminal pre-selected from the lookup, plus "Lands …" and the gate.
   - On the owner/driver ride view: landing time, gate, "free wait until …" (landing + 30 min), and "Terminal from the flight lookup".
4. **Airport trip without a flight number:**
   - Airline "Another airline" pre-selects Domestic North.
   - Delta shows "Domestic South or International. Pick the terminal on your ticket" and pre-selects nothing.
5. **ATL International vs Domestic:** same drop-off, switch the terminal. Expect different miles (after the curb pins, the right ones).
6. **Flight lookup down:** use a wrong `FLIGHT_API_KEY` or `FLIGHT_DAILY_CAP=0`.
   - The rider sees the airline table or "Pick your terminal", never an error.
   - The Worker logs show `flight lookup`.
7. **Driver geolocation allowed vs denied:** sign in as a driver.
   - One browser prompt per session.
   - Allowed: suggestions lean toward the driver.
   - Denied: they lean toward the fleet base.
   - No new prompt in the same session. Nothing extra is sent to the server.
   - Note: Nudge drivers have few address fields today, so this mostly matters for future driver screens.
8. **Rider typing a common street name:** type "Main St" on the booking page. Alpharetta / North Atlanta results should come first.
9. **Out-of-area address:** pick a Nashville address. It can still be selected, routes and prices normally.
10. **Round trip:** one way x the fleet's "Round trip = one way x" setting in Rates (new fleets start at 2, as before; existing fleets keep theirs).
11. **Hourly:** 4 h comes to $225 + 4 x $18.75 = $300. No Google call.
12. **Google down:** remove `GOOGLE_ROUTES_KEY` and `GOOGLE_MAPS_SERVER_KEY`, or use a wrong key.
    - The booking page shows "We'll confirm your price shortly", with no number.
    - The request goes through. The owner sees **Price needed**, types a price, and that price becomes the fare and the invoice amount.
13. **Caps reached:** set `ROUTES_DAILY_CAP=0`. You get the same result as step 12, and the logs show `daily-cap`.
14. **Responsive check:** booking page and More > Rates at 390, 768 and 1024 px.
    - `node scripts/e2e/distance-shots.mjs` runs this locally.
    - Also run `bash scripts/predeploy-e2e.sh`.

Locally: `npm run check`. If wrangler's proxy warning breaks `--json` parsing in this environment, unset `HTTPS_PROXY` for the run.

## 7. Rollback

To return to the previous Worker version:
1. Redeploy the previous Worker version. The new columns and tables are unused by it.
2. Restore the old rate sheets with:

```sql
UPDATE rate_sheets SET sheet_json = (SELECT l.sheet_json FROM rate_sheets_legacy l WHERE l.company_id = rate_sheets.company_id),
  enabled = (SELECT l.enabled FROM rate_sheets_legacy l WHERE l.company_id = rate_sheets.company_id)
WHERE company_id IN (SELECT company_id FROM rate_sheets_legacy);
```

## Known limits

- **Airport fee can be dodged:** autocomplete Place types and locations come from the browser. A crafted request could skip the airport fee.
  The owner still approves every price.
- **Flight lookup is for pickups only:** an airport pickup gets the lookup. A drop-off uses only the airline table, because the provider's terminal is the arrival terminal.
- **Fees and gratuity:** the old fee and gratuity settings now apply to hourly trips only.
- **Old address proxy:** the earlier server-side proxy (`PLACES_AUTOCOMPLETE=on` with `GOOGLE_MAPS_SERVER_KEY`) is still in the code. It is used only when no browser key is set.
- **No map:** Nudge's owner and driver app has no map, so there is nothing to center. The fleet base and driver position only bias address suggestions.
- **Iron Gate:** not done. It needs the `1b5e031` baseline tarball, the `irongate-maps` Worker source, and Jesse's rates and base location.
