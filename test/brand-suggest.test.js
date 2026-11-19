import assert from "node:assert/strict";
import test from "node:test";
import { checkSuggestUrl, isPrivateIp, safeFetch, suggestBrand, suggestFromPage, toSimple, SUGGEST_LIMITS, SUGGEST_UA } from "../app/brand-suggest.js";

const PUBLIC = async () => ["93.184.216.34"];
function res(status, body = "", headers = {}) {
  return new Response(body, { status, headers });
}
function router(routes, log = []) {
  return async (url, init = {}) => {
    log.push({ url, init });
    const r = routes[url];
    if (!r) return res(404, "nope");
    return typeof r === "function" ? r(init) : r();
  };
}

test("URL vetting: https only, public DNS names only", () => {
  assert.equal(checkSuggestUrl("example.com").href, "https://example.com/");
  assert.equal(checkSuggestUrl("https://Example.com/about#x").href, "https://example.com/about");
  const bad = [
    "", "http://example.com", "ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi",
    "https://localhost", "https://foo.localhost", "https://intranet", "https://printer.local", "https://db.internal",
    "https://127.0.0.1", "https://10.0.0.5", "https://169.254.169.254/latest/meta-data", "https://2130706433",
    "https://0x7f000001", "https://0177.0.0.1", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[fe80::1]",
    "https://user:pass@example.com", "https://example.com:8443", "https://example.com:80", "https://" + "a".repeat(600) + ".com",
  ];
  for (const u of bad) assert.throws(() => checkSuggestUrl(u), (e) => e.code === "url", u);
});

test("private / reserved IPs are blocked", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "64:ff9b::a00:1", "not-an-ip", ""]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001::200e"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("hostname resolving to a private address is refused before any fetch", async () => {
  const log = [];
  const f = router({ "https://evil.example.org/": () => res(200, "<html></html>", { "content-type": "text/html" }) }, log);
  await assert.rejects(safeFetch("https://evil.example.org/", { fetchImpl: f, resolve: async () => ["93.184.216.34", "10.0.0.7"], cap: 1000, types: ["text/html"] }), (e) => e.code === "blocked");
  assert.equal(log.length, 0);
  await assert.rejects(safeFetch("https://nx.example.org/", { fetchImpl: f, resolve: async () => [], cap: 1000 }), (e) => e.code === "dns");
});

test("redirects: re-vetted every hop; to private, to http, and loops are refused", async () => {
  const resolveMap = { "site.example.org": ["93.184.216.34"], "rebind.example.org": ["127.0.0.1"] };
  const resolve = async (h) => resolveMap[h] || ["93.184.216.34"];
  const f = router({
    "https://site.example.org/": () => res(302, "", { location: "https://rebind.example.org/" }),
    "https://a.example.org/": () => res(301, "", { location: "http://a.example.org/" }),
    "https://b.example.org/": () => res(302, "", { location: "https://169.254.169.254/latest" }),
    "https://loop.example.org/": () => res(302, "", { location: "/" }),
  });
  await assert.rejects(safeFetch("https://site.example.org/", { fetchImpl: f, resolve, cap: 1000 }), (e) => e.code === "blocked");
  await assert.rejects(safeFetch("https://a.example.org/", { fetchImpl: f, resolve, cap: 1000 }), (e) => e.code === "url");
  await assert.rejects(safeFetch("https://b.example.org/", { fetchImpl: f, resolve, cap: 1000 }), (e) => e.code === "url");
  await assert.rejects(safeFetch("https://loop.example.org/", { fetchImpl: f, resolve, cap: 1000 }), /too many times/);
});

test("requests send no cookies or caller headers and never auto-follow redirects", async () => {
  const log = [];
  const f = router({ "https://ok.example.org/": () => res(200, "<html></html>", { "content-type": "text/html" }) }, log);
  await safeFetch("https://ok.example.org/", { fetchImpl: f, resolve: PUBLIC, cap: 1000, types: ["text/html"] });
  const init = log[0].init;
  assert.equal(init.redirect, "manual");
  assert.equal(init.method, "GET");
  assert.deepEqual(Object.keys(init.headers).sort(), ["accept", "user-agent"]);
  assert.equal(init.headers["user-agent"], SUGGEST_UA);
});

test("size caps: by content-length and while streaming", async () => {
  const big = "x".repeat(2000);
  const f = router({
    "https://len.example.org/": () => res(200, "small", { "content-type": "text/html", "content-length": String(SUGGEST_LIMITS.htmlBytes + 1) }),
    "https://stream.example.org/": () => res(200, new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode(big)); c.close(); } }), { "content-type": "text/html" }),
  });
  await assert.rejects(safeFetch("https://len.example.org/", { fetchImpl: f, resolve: PUBLIC, cap: SUGGEST_LIMITS.htmlBytes }), (e) => e.code === "size");
  await assert.rejects(safeFetch("https://stream.example.org/", { fetchImpl: f, resolve: PUBLIC, cap: 5000 }), (e) => e.code === "size");
});

test("non-HTML content is refused", async () => {
  const f = router({ "https://pdf.example.org/": () => res(200, "%PDF", { "content-type": "application/pdf" }) });
  await assert.rejects(safeFetch("https://pdf.example.org/", { fetchImpl: f, resolve: PUBLIC, cap: 1000, types: ["text/html"] }), (e) => e.code === "type");
});

test("timeout aborts a hanging site", async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const t0 = Date.now();
  await assert.rejects(suggestBrand("https://slow.example.org/", { fetchImpl: hang, resolve: PUBLIC, timeoutMs: 150 }), (e) => e.code === "timeout");
  assert.ok(Date.now() - t0 < 2000);
});

const SAMPLE = `<!doctype html><html><head>
<meta name="theme-color" content="#a8842f">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Libre+Franklin&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<link rel="apple-touch-icon" href="/img/logo-180.png">
<style>body{background:#f5f0e6;color:#111111}.btn{background:#a8842f;color:#111}</style>
</head><body><img class="site-logo" src="/img/logo.png" alt="Gold Standard"><script>alert(1)</script></body></html>`;

test("extraction: colors, fonts, logo; nothing executed", () => {
  const found = suggestFromPage(SAMPLE, "body{background:#f5f0e6;color:#111111}.btn{background:#a8842f;color:#111}", new URL("https://gsl.example.org/"));
  assert.equal(found.background, "#f5f0e6");
  assert.equal(found.text, "#111111");
  assert.equal(found.primary, "#a8842f");
  assert.ok(found.fonts.includes("Cormorant Garamond"));
  assert.equal(found.logo, "https://gsl.example.org/img/logo.png");
  const simple = toSimple(found);
  assert.equal(simple.base, "light");
  assert.equal(simple.pair, "classic");
});

test("full pipeline with stylesheet + logo, and a redirect", async () => {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const f = router({
    "https://gsl.example.org/": () => res(301, "", { location: "https://www.gsl.example.org/" }),
    "https://www.gsl.example.org/": () => res(200, SAMPLE, { "content-type": "text/html; charset=utf-8" }),
    "https://www.gsl.example.org/site.css": () => res(200, "a{color:#8a6d24}", { "content-type": "text/css" }),
    "https://www.gsl.example.org/img/logo.png": () => res(200, png, { "content-type": "image/png" }),
  });
  const out = await suggestBrand("gsl.example.org", { fetchImpl: f, resolve: PUBLIC });
  assert.equal(out.url, "https://www.gsl.example.org/");
  assert.equal(out.simple.primary, "#a8842f");
  assert.match(out.logoDataUrl, /^data:image\/png;base64,/);
});

test("dark site maps to dark base with readable text", () => {
  const s = toSimple({ background: "#0b0b0b", text: "#333333", primary: "#e8d060", accent: "", fonts: [], logo: "" });
  assert.equal(s.base, "dark");
  assert.equal(s.text, "#f5f5f5");
  assert.equal(s.pair, "standard");
});
