# Voice-to-ride (PREVIEW)

An inbound phone call is answered by a Bland AI phone agent, which collects the ride and hangs up. Bland's
post-call webhook turns the finished call into a **draft ride** (`source = 'voice'`, `approval = 'requested'`)
in the owner's Rides queue with a suggested driver: the same pipeline, edit form, and approve step as
text-to-ride (PR #24). Nothing is booked, quoted, charged, texted, or called back automatically.

Stacked on `text-to-ride` (PR #24). Preview only. Not attached to any Bland number.

## Pieces

| Piece | Where |
| --- | --- |
| Agent script, extraction keys, summary prompt | `docs/voice-booking/agent-prompt.md` |
| Example Bland inbound-number config (not applied anywhere) | `docs/voice-booking/bland-inbound-config.example.json` |
| Pure parsing (payload → fields → draft) | `app/voice-intake.js` |
| Webhook, follow-up, owner switch | `app/index.js` (`postBlandVoice`, `voiceFollowUp`, `ownerVoiceToggle`) |
| Migration | `migrations/0016_voice_booking.sql` (preview D1 only) |
| Owner UI | Rides card "From call, needs approval"; ride page call summary, transcript, recording link, draft form; More → Phone booking switch |
| Tests | `test/voice-intake.test.js` (unit), `test/voice-intake-api.test.js` (end to end on local workerd + D1), payloads in `test/fixtures/bland-voice.js` |

## Webhook

`POST /api/inbound/bland/voice/<VOICE_INTAKE_TOKEN>`

* 404 unless the path token matches the `VOICE_INTAKE_TOKEN` Worker secret (empty = endpoint off).
* When `BLAND_WEBHOOK_SECRET` is set, `X-Webhook-Signature` (hex HMAC-SHA256 of the raw body) is required; 401 otherwise.
* Body: Bland's post-call payload (the `GET /v1/calls/:id` object): `call_id`, `to`, `from`, `inbound`, `completed`,
  `call_length` (minutes), `summary`, `transcripts[]` / `concatenated_transcript`, `recording_url`, `variables`,
  `analysis`, `agent_dispositions`.
* Ignored with 200 (so Bland does not retry): outbound calls, numbers without voice on, other `event_type`s, hang-ups with no words.
* Idempotent: `inbound_calls.dedupe_key = 'call|<call_id>'` is claimed with `INSERT OR IGNORE` before the ride is
  written, so a Bland retry (or a race) returns `{ duplicate: true, rideId }`.
* A later `event_type: "dispositions"` (Bland Agents "Follow-up event") fills blanks on the still-open, unedited
  draft; deduplicated on `X-Webhook-Idempotency-Key`.
* Rate limits: 120 calls / 10 min overall, 6 calls / hour per caller per company.

Field sources, best first: Bland's structured values (`agent_dispositions[].payload`, then `analysis`, then
named `variables` such as `pickup_address`; Bland's system variables like `now`/`from` are never read as ride
fields) → the agent's labeled read-back ("To confirm: Pickup: … Drop-off: … Date: … Time: …") → the
existing text-to-ride parser over what the caller said. The draft records which source each field came from
and lists warnings (missing pieces, no AM/PM, unconfirmed read-back, callback ≠ caller ID, hidden caller ID,
"caller asked for a call back").

The client is matched by callback number or caller ID; otherwise a client is added ("Dana Lee", or
"Call from (404) 555-0123"). Suggested driver uses the same rule as texts (free at that time, fewest rides that day).

## Call routing

* One number per company, shared with text-to-ride: `text_intake_settings.inbound_number` (UNIQUE), so a number
  can never feed two fleets. `enabled` is the text switch; `voice_enabled` (new, default 0) is the voice switch.
* Only Nudge Dispatch (platform admin or `ADMIN_TOKEN`) assigns a number:
  `PUT /api/admin/companies/:id/text-intake { inboundNumber, enabled?, voiceEnabled? }`.
* The owner turns AI call answering on or off for their own number: More → Phone booking, or
  `PUT /api/voice-intake { enabled }`. With voice off, calls to that number are ignored by Nudge.
* Bland side (go-live): the number's inbound config gets the prompt + `webhook` =
  `https://<worker>/api/inbound/bland/voice/<VOICE_INTAKE_TOKEN>` (or attach a Bland Agent with the
  `ride_request` disposition). The webhook finds the company from the call's `to` number.
* The owner switch only controls whether Nudge drafts rides. To stop the AI from answering at all, the
  number's Bland inbound config must change too (a later step could have the switch call Bland's
  `POST /v1/inbound/{number}` to swap between the agent and a plain forward to the owner's phone).

## Number decision (prototype)

No number is attached. `+1 440-644-2454` is shared with Iron Gate: its inbound texts feed Iron Gate's live
CRM text-to-ride, and changing its inbound voice agent would change what real Iron Gate callers hear. The
prototype is tested with signed, simulated Bland webhooks only. Recommendation: a dedicated Bland number per
Nudge fleet (or one Nudge number to start), so routing is one-number-one-company and Iron Gate is untouched.
