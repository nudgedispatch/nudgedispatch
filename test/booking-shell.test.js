import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyBookingPageHtml, bookingShortName, escapeHtml } from "../app/booking-shell.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bookHtml = readFileSync(join(root, "app/book.html"), "utf8");
const bookJs = readFileSync(join(root, "app/client-book.txt"), "utf8");
const bookSw = readFileSync(join(root, "app/client-book-sw.txt"), "utf8");

test("bookingShortName matches the manifest 12-character rule", () => {
  assert.equal(bookingShortName(""), "Book a ride");
  assert.equal(bookingShortName("  "), "Book a ride");
  assert.equal(bookingShortName("Bailey"), "Bailey");
  assert.equal(bookingShortName("Bailey Consulting"), "Bailey");
  assert.equal(bookingShortName("Iron Gate Transportation"), "Iron");
  assert.equal(bookingShortName("AB Super Long Company Name"), "AB Super Lon");
  assert.equal(bookingShortName("the operator"), "the operator");
});

test("escapeHtml encodes attribute and text characters", () => {
  assert.equal(escapeHtml(`Acme <Rides> & "Co'`), "Acme &lt;Rides&gt; &amp; &quot;Co&#39;");
  assert.equal(escapeHtml(""), "");
});

test("applyBookingPageHtml sets escaped title and short apple-mobile-web-app-title", () => {
  const html = applyBookingPageHtml(bookHtml, {
    jsSrc: "/book.js?v=test",
    companyName: `Acme <Rides> & "Co'`,
  });
  assert.match(html, /src="\/book\.js\?v=test"/);
  assert.match(html, /<title>Acme &lt;Rides&gt; &amp; &quot;Co&#39;<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Acme">/);
  assert.doesNotMatch(html, /<title>Book a ride<\/title>/);
  assert.doesNotMatch(html, /content="Book a ride"/);
  assert.doesNotMatch(html, /<Rides>/);
  assert.doesNotMatch(html, /content="Acme <Rides>/);
});

test("applyBookingPageHtml short name is escaped when it contains markup", () => {
  const html = applyBookingPageHtml(bookHtml, { companyName: `<A&B> Cars And More` });
  assert.match(html, /<title>&lt;A&amp;B&gt; Cars And More<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="&lt;A&amp;B&gt;">/);
});

test("applyBookingPageHtml keeps the default titles when no company name is given", () => {
  const html = applyBookingPageHtml(bookHtml, { jsSrc: "/book.js?v=test" });
  assert.match(html, /<title>Book a ride<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Book a ride">/);
  assert.match(html, /src="\/book\.js\?v=test"/);
});

test("the booking page includes a CSP-safe install prompt and v5 service worker cache", () => {
  assert.match(bookHtml, /id="installBar"/);
  assert.match(bookHtml, /id="installApp"/);
  assert.match(bookHtml, />Install app</);
  assert.match(bookHtml, /Tap Share, then Add to Home Screen/);
  assert.doesNotMatch(bookHtml, /style="/);
  assert.doesNotMatch(bookHtml, /<script(?![^>]*src=)/);
  assert.match(bookJs, /beforeinstallprompt/);
  assert.match(bookJs, /display-mode: standalone/);
  assert.match(bookJs, /nudge-book-install-dismissed/);
  assert.match(bookJs, /setupInstallPrompt/);
  assert.match(bookJs, /document\.title = companyName/);
  assert.match(bookSw, /nudge-book-shell-v5/);
});
