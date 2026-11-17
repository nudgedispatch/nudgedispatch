import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = fs.readFileSync(join(root, "app/client-app.txt"), "utf8");
const start = client.indexOf("/* a2hs-logic-start */");
const end = client.indexOf("/* a2hs-logic-end */");
assert.ok(start >= 0 && end > start, "a2hs logic markers should be present in client-app.txt");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(client.slice(start, end + "/* a2hs-logic-end */".length), sandbox);
const a2hs = sandbox.NudgeA2hs;
assert.ok(a2hs && typeof a2hs.shouldShow === "function");

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_EDGE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.2210.150 Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_FB = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0]";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IPAD_SAFARI = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function show(overrides) {
  const result = a2hs.shouldShow({
    standalone: false,
    desktop: false,
    dismissedAt: 0,
    now: NOW,
    ios: false,
    iosSafari: false,
    hasNativePrompt: false,
    ...overrides,
  });
  return { show: !!result.show, variant: String(result.variant || ""), reason: String(result.reason || "") };
}

test("Android Chrome with a captured native prompt shows Install Nudge", () => {
  assert.deepEqual(show({ hasNativePrompt: true }), { show: true, variant: "android", reason: "" });
});

test("iOS Safari shows the Share then Add to Home Screen card", () => {
  assert.deepEqual(show({ ios: true, iosSafari: true }), { show: true, variant: "ios-safari", reason: "" });
});

test("iOS Chrome, Firefox, Edge, or in-app browsers tell the user to open Safari", () => {
  assert.deepEqual(show({ ios: true, iosSafari: false }), { show: true, variant: "ios-other", reason: "" });
});

test("desktop is hidden even when beforeinstallprompt fired", () => {
  assert.deepEqual(show({ desktop: true, hasNativePrompt: true }), { show: false, variant: "", reason: "desktop" });
});

test("standalone or already-installed display mode is hidden", () => {
  assert.deepEqual(show({ standalone: true, hasNativePrompt: true }), { show: false, variant: "", reason: "standalone" });
  assert.deepEqual(show({ standalone: true, ios: true, iosSafari: true }), { show: false, variant: "", reason: "standalone" });
});

test("Not now is remembered for 14 days and then offered again", () => {
  assert.deepEqual(show({ ios: true, iosSafari: true, dismissedAt: NOW - (14 * DAY - 1) }), { show: false, variant: "", reason: "dismissed" });
  assert.deepEqual(show({ ios: true, iosSafari: true, dismissedAt: NOW - 14 * DAY }), { show: true, variant: "ios-safari", reason: "" });
  assert.deepEqual(show({ hasNativePrompt: true, dismissedAt: NOW - 14 * DAY - 1 }), { show: true, variant: "android", reason: "" });
});

test("Android without a captured native prompt stays hidden", () => {
  assert.deepEqual(show({}), { show: false, variant: "", reason: "no-prompt" });
});

test("user-agent helpers detect iOS Safari, other iOS browsers, Android, and desktop", () => {
  assert.equal(a2hs.isIos(IPHONE_SAFARI, "iPhone", 5), true);
  assert.equal(a2hs.isIosSafari(IPHONE_SAFARI, "iPhone", 5), true);
  assert.equal(a2hs.isDesktop(IPHONE_SAFARI, "iPhone", 5), false);

  assert.equal(a2hs.isIosSafari(IPHONE_CHROME, "iPhone", 5), false);
  assert.equal(a2hs.isIosSafari(IPHONE_FIREFOX, "iPhone", 5), false);
  assert.equal(a2hs.isIosSafari(IPHONE_EDGE, "iPhone", 5), false);
  assert.equal(a2hs.isIosSafari(IPHONE_FB, "iPhone", 5), false);
  assert.equal(a2hs.isIos(IPHONE_CHROME, "iPhone", 5), true);

  assert.equal(a2hs.isIos(IPAD_SAFARI, "iPad", 5), true);
  assert.equal(a2hs.isIosSafari(IPAD_SAFARI, "iPad", 5), true);
  assert.equal(a2hs.isIos("", "MacIntel", 5), true);
  assert.equal(a2hs.isDesktop("", "MacIntel", 5), false);
  assert.equal(a2hs.isIos("", "MacIntel", 0), false);

  assert.equal(a2hs.isDesktop(ANDROID_CHROME, "Linux armv8l", 5), false);
  assert.equal(a2hs.isIos(ANDROID_CHROME, "Linux armv8l", 5), false);
  assert.equal(a2hs.isDesktop(DESKTOP_CHROME, "Win32", 0), true);
  assert.equal(a2hs.isIos(DESKTOP_CHROME, "Win32", 0), false);
});

test("standalone is true for display-mode or navigator.standalone", () => {
  assert.equal(a2hs.isStandalone(true, false), true);
  assert.equal(a2hs.isStandalone(false, true), true);
  assert.equal(a2hs.isStandalone(false, false), false);
});

test("dismissed timestamp is stored and read from localStorage, and private-mode writes do not throw", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  assert.equal(a2hs.readDismissedAt(storage), 0);
  a2hs.writeDismissedAt(storage, NOW);
  assert.equal(storage.getItem(a2hs.STORAGE_KEY), String(NOW));
  assert.equal(a2hs.readDismissedAt(storage), NOW);
  assert.equal(a2hs.REOFFER_MS, 14 * DAY);
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(a2hs.readDismissedAt(broken), 0);
  a2hs.writeDismissedAt(broken, NOW);
  a2hs.writeDismissedAt(null, NOW);
});

test("the main app already has 192, 512, maskable, and apple-touch icons", () => {
  const manifest = fs.readFileSync(join(root, "app/manifest.webmanifest"), "utf8");
  const html = fs.readFileSync(join(root, "app/index.html"), "utf8");
  assert.match(manifest, /\/icons\/icon-192\.png/);
  assert.match(manifest, /\/icons\/icon-512\.png/);
  assert.match(manifest, /\/icons\/icon-192-maskable\.png/);
  assert.match(manifest, /\/icons\/icon-512-maskable\.png/);
  assert.match(manifest, /"purpose": "maskable"/);
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
  for (const name of ["icon-192.png", "icon-512.png", "icon-192-maskable.png", "icon-512-maskable.png", "apple-touch-icon.png"]) {
    assert.ok(fs.existsSync(join(root, "app/icons", name)), name);
  }
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline/);
});

test("login success paths offer the prompt, and CSP is not loosened in the client", () => {
  const offers = client.split("offerA2hsAfterLogin()").length - 1;
  // Definition plus login, invite, boot-on-welcome, and the welcome screen itself.
  assert.equal(offers, 6);
  assert.match(client, /location\.hash === "#\/welcome"\) offerA2hsAfterLogin\(\)/);
  assert.match(client, /wireA2hsCapture\(\);/);
  assert.match(client, /addEventListener\("beforeinstallprompt"/);
  assert.match(client, /event\.preventDefault\(\)/);
  assert.match(client, /deferredInstallPrompt\.prompt\(\)/);
  assert.match(client, /Install Nudge/);
  assert.match(client, /Add to Home Screen/);
  assert.match(client, /Open this page in Safari/);
  assert.match(client, /Not now/);
  assert.match(client, /hideA2hsPrompt\(\);/);
  assert.doesNotMatch(client, /<script>/);
});
