// Fake PayPal for PAYPAL_MODE=mock (isolated previews only). No network; nothing is emailed or charged.
// Ids are derived from the PayPal-Request-Id so retries return the same invoice, like the real API.
export const MOCK_WEBHOOK_SIGNATURE = "mock-signature";

function reply(status, data) {
  return { status, data };
}
function mockInvoiceId(requestId) {
  const tail = String(requestId || "none").replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toUpperCase();
  return "INV2-MOCK-" + tail;
}

export function mockPayPal(method, path, headers, body) {
  const h = headers || {};
  if (path === "/v1/oauth2/token" && method === "POST") {
    return String(h.authorization || "").startsWith("Basic ") ? reply(200, { access_token: "mock-access-token", token_type: "Bearer", expires_in: 32400 }) : reply(401, { error: "invalid_client" });
  }
  if (!String(h.authorization || "").startsWith("Bearer ")) return reply(401, { name: "AUTHENTICATION_FAILURE" });
  if (path === "/v2/invoicing/invoices" && method === "POST") {
    let draft = {};
    try { draft = JSON.parse(body || "{}"); } catch { draft = {}; }
    const id = mockInvoiceId(h["paypal-request-id"]);
    return reply(201, { id, status: "DRAFT", detail: { ...(draft.detail || {}), metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#" + id } }, amount: { currency_code: "USD", value: "0.00" } });
  }
  const send = /^\/v2\/invoicing\/invoices\/([A-Z0-9-]+)\/send$/.exec(path);
  if (send && method === "POST") return reply(200, { rel: "payer-view", method: "GET", href: "https://www.sandbox.paypal.com/invoice/p/#" + send[1] });
  const one = /^\/v2\/invoicing\/invoices\/([A-Z0-9-]+)$/.exec(path);
  if (one && method === "GET") return reply(200, { id: one[1], status: "SENT", detail: { metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#" + one[1] } }, due_amount: { currency_code: "USD", value: "1.00" } });
  if (path === "/v1/notifications/verify-webhook-signature" && method === "POST") {
    let req = {};
    try { req = JSON.parse(body || "{}"); } catch { req = {}; }
    return reply(200, { verification_status: req.transmission_sig === MOCK_WEBHOOK_SIGNATURE && req.webhook_id ? "SUCCESS" : "FAILURE" });
  }
  return reply(404, { name: "RESOURCE_NOT_FOUND" });
}
