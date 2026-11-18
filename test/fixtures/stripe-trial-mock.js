// Local Stripe mock for the 15-ride trial signup (setup-mode Checkout + trialing subscription).
import { createServer } from "node:http";

export function startTrialStripeMock() {
  const hits = [];
  const st = { sessionStatus: "complete", setupStatus: "succeeded", pmType: "card", subStatus: "trialing", failUpdate: false };
  const card = () => ({ id: "pm_signup", object: "payment_method", livemode: false, type: st.pmType, card: st.pmType === "card" ? { brand: "visa", display_brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030, fingerprint: "fp_s" } : undefined });
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const raw = Buffer.concat(chunks).toString();
      const body = decodeURIComponent(raw).replace(/\+/g, " ");
      hits.push({ method: req.method, path: url.pathname, query: decodeURIComponent(url.search), body, idem: req.headers["idempotency-key"] || "" });
      const send = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      const p = url.pathname;
      const signupId = () => new URLSearchParams(hits.findLast((h) => h.path === "/v1/checkout/sessions" && h.method === "POST")?.body || "").get("metadata[signup_id]") || "sig";
      if (p === "/v1/prices") {
        const keys = [...url.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
        return send({ object: "list", data: keys.map((k) => ({ id: "price_" + k, object: "price", livemode: false, lookup_key: k, product: "prod_" + k })) });
      }
      if (p === "/v1/customers" && req.method === "POST") return send({ id: "cus_signup", object: "customer", livemode: false });
      if (p === "/v1/customers/cus_signup") return send({ id: "cus_signup", object: "customer", livemode: false, invoice_settings: { default_payment_method: card() } });
      if (p === "/v1/checkout/sessions" && req.method === "POST") {
        return send({ id: "cs_test_signupsession1", object: "checkout.session", livemode: false, mode: "setup", url: "https://checkout.stripe.com/c/pay/cs_test_signupsession1", metadata: { purpose: "signup", signup_id: signupId() } });
      }
      const cs = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(p);
      if (cs) {
        return send({
          id: cs[1], object: "checkout.session", livemode: false, mode: "setup", status: st.sessionStatus, payment_status: "no_payment_required",
          customer: "cus_signup",
          setup_intent: { id: "seti_1", object: "setup_intent", livemode: false, status: st.setupStatus, payment_method: card() },
          metadata: { purpose: "signup", signup_id: signupId(), plan: "solo", sms: "off" },
        });
      }
      if (p === "/v1/subscriptions" && req.method === "POST") return send({ id: "sub_signup", object: "subscription", livemode: false, status: "trialing", customer: "cus_signup" });
      if (p === "/v1/subscriptions/sub_signup" && req.method === "POST") {
        if (st.failUpdate) return send({ error: { message: "mock: Stripe is down" } }, 500);
        return send({ id: "sub_signup", object: "subscription", livemode: false, status: "active", customer: "cus_signup" });
      }
      if (p === "/v1/subscriptions/sub_signup" && req.method === "DELETE") return send({ id: "sub_signup", object: "subscription", livemode: false, status: "canceled", customer: "cus_signup" });
      if (p === "/v1/subscriptions/sub_signup") return send({ id: "sub_signup", object: "subscription", livemode: false, status: st.subStatus, customer: "cus_signup" });
      return send({ error: { message: "mock: no route " + req.method + " " + p } }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ hits, st, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(() => d())) })));
}
