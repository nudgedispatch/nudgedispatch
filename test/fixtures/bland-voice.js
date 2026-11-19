// Simulated Bland post-call webhook payloads, shaped like docs.bland.ai/tutorials/post-call-webhooks
// (the GET /v1/calls/:id object) for an INBOUND call. Fake numbers (555-01xx) only.
export const FLEET_NUMBER = "+14045550100";

export function inboundCall(over = {}) {
  const callId = over.call_id || "c0ffee00-1111-4222-8333-444455556666";
  return {
    call_id: callId, c_id: callId, call_length: 2.4, batch_id: null,
    to: FLEET_NUMBER, from: "+14045550123", completed: true, created_at: "2026-11-19T19:10:00.000+00:00",
    inbound: true, queue_status: "complete", max_duration: 6, error_message: null,
    variables: { now: "Thursday, November 19, 2026 2:10 PM", from: "+14045550123", to: FLEET_NUMBER, short_from: "4045550123", call_id: callId, phone_number: "+14045550123", country: "US", timezone: "America/New_York" },
    answered_by: "human", record: true, recording_url: "https://server.aws.dialpad.example/recordings/" + callId + ".mp3",
    metadata: { app: "nudge", flow: "voice-to-ride" },
    summary: "Dana Lee requested a pickup at ATL Domestic Terminal tomorrow at 8:15 PM, going to 3500 Lenox Rd NE. She confirmed the details.",
    price: 0.34, started_at: "2026-11-19T19:10:00.000Z", call_ended_by: "ASSISTANT", status: "completed",
    concatenated_transcript: "assistant: Thanks for calling Voice Cars. Where should we pick you up? \n user: Hi, I'm landing at ATL domestic terminal tomorrow evening on Delta 1742. \n assistant: And where are you going? \n user: 3500 Lenox Road Northeast. \n assistant: What time should we pick you up? \n user: 8:15 PM. \n assistant: And your name? \n user: Dana Lee. \n assistant: Is the number you're calling from the best one to reach you? \n user: Yes. \n assistant: To confirm: Pickup: ATL Domestic Terminal. Drop-off: 3500 Lenox Rd NE, Atlanta. Date: tomorrow. Time: 8:15 PM. Name: Dana Lee. Callback number: (404) 555-0123. Passengers: 1. Is that right? \n user: Yes that's right. \n assistant: Thanks. The owner will confirm your ride and the price shortly. \n agent-action: Ended call \n ",
    transcripts: [
      { id: 1, user: "assistant", text: "Thanks for calling Voice Cars. Where should we pick you up?", created_at: "2026-11-19T19:10:01.000+00:00" },
      { id: 2, user: "user", text: "Hi, I'm landing at ATL domestic terminal tomorrow evening on Delta 1742.", created_at: "2026-11-19T19:10:05.000+00:00" },
      { id: 3, user: "assistant", text: "And where are you going?", created_at: "2026-11-19T19:10:09.000+00:00" },
      { id: 4, user: "user", text: "3500 Lenox Road Northeast.", created_at: "2026-11-19T19:10:12.000+00:00" },
      { id: 5, user: "assistant", text: "What time should we pick you up?", created_at: "2026-11-19T19:10:15.000+00:00" },
      { id: 6, user: "user", text: "8:15 PM.", created_at: "2026-11-19T19:10:17.000+00:00" },
      { id: 7, user: "assistant", text: "And your name?", created_at: "2026-11-19T19:10:19.000+00:00" },
      { id: 8, user: "user", text: "Dana Lee.", created_at: "2026-11-19T19:10:21.000+00:00" },
      { id: 9, user: "assistant", text: "To confirm: Pickup: ATL Domestic Terminal. Drop-off: 3500 Lenox Rd NE, Atlanta. Date: tomorrow. Time: 8:15 PM. Name: Dana Lee. Callback number: (404) 555-0123. Passengers: 1. Is that right?", created_at: "2026-11-19T19:10:30.000+00:00" },
      { id: 10, user: "user", text: "Yes that's right.", created_at: "2026-11-19T19:10:34.000+00:00" },
      { id: 11, user: "agent-action", text: "Ended call", created_at: "2026-11-19T19:10:40.000+00:00" },
    ],
    ...over,
  };
}

// Bland Agents call: structured values arrive in agent_dispositions (no analysis on agent calls).
export function agentCall(over = {}) {
  const callId = over.call_id || "agent000-1111-4222-8333-444455556666";
  return inboundCall({
    call_id: callId, c_id: callId, from: "+14045550145",
    summary: "Marcus Green booked a ride from the Four Seasons Atlanta to PDK on Friday at 6:40 AM for 2 passengers.",
    transcripts: [
      { id: 1, user: "assistant", text: "Thanks for calling. Where should we pick you up?", created_at: "2026-11-19T19:20:01.000+00:00" },
      { id: 2, user: "user", text: "Four Seasons Atlanta, going to PDK Friday morning, 6:40, two of us.", created_at: "2026-11-19T19:20:05.000+00:00" },
    ],
    concatenated_transcript: undefined,
    agent_id: "agt_preview", agent_version_id: "agv_preview",
    agent_dispositions: [{
      disposition_id: "d1", disposition_key: "ride_request", name: "Ride request", status: "complete",
      payload: { pickup_address: "Four Seasons Atlanta, 75 14th St NE", dropoff_address: "PDK (Peachtree-DeKalb)", pickup_date: "Friday", pickup_time: "06:40", rider_name: "Marcus Green", callback_number: "404-555-0146", passengers: 2, bags: "3", needs_callback: false, details_confirmed: true, notes: "Child seat please" },
      values: [], executed_at: "2026-11-19T19:21:00.000Z",
    }],
    ...over,
  });
}
