import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import test from "node:test";
import {
  buildInvoiceLayout,
  canShareFile,
  cleanText,
  defaultMeasureText,
  formatIssued,
  formatTime,
  invoiceFileName,
  invoiceSendLinks,
  invoiceShareText,
  invoiceShareTitle,
  isSafeLogoDataUrl,
  preferredShareFile,
  rgbToPdf,
  wrapLines,
} from "../app/invoice-image.js";

function sample(overrides = {}) {
  return {
    number: "TGS-1001",
    fare: "$125.00",
    issuedOn: "2026-11-16",
    snapshotText: "INVOICE\nThe Gold Standard Limo\n\nInvoice #: TGS-1001\nNothing was sent automatically. Copy this.",
    billTo: { name: "Avery Cole", phone: "(404) 555-0199", email: "avery@example.test" },
    payWith: [
      { kind: "cashapp", label: "Cash App", display: "$TGSLimo", url: "https://cash.app/$TGSLimo/125.00" },
      { kind: "zelle", label: "Zelle", display: "(404) 555-0123", url: "" },
      { kind: "cash", label: "Cash", display: "Pay your driver in cash", url: "" },
    ],
    payLines: [
      "Cash App: $TGSLimo https://cash.app/$TGSLimo/125.00",
      "Zelle: (404) 555-0123",
      "Cash: Pay your driver in cash",
    ],
    trip: {
      date: "2026-11-18",
      time: "09:30",
      pickup: "Hotel Indigo Atlanta",
      dropoff: "Hartsfield-Jackson Atlanta International Airport",
      stops: ["Atlantic Station"],
      passengers: 2,
      flight: "DL 1234",
    },
    business: {
      name: "The Gold Standard Limo",
      address: "Atlanta, GA",
      phone: "(404) 555-0100",
      email: "thegoldstandardlimo@gmail.com",
      website: "goldstandard.example",
      paymentInstructions: "Card accepted in the car.",
      terms: "Due on receipt.",
      gratuityNote: "Price does not include gratuity.",
      logoDataUrl: "data:image/png;base64,AAA",
    },
    ...overrides,
  };
}

test("layout includes logo space, business, invoice number, client, trip lines, totals, and pay links", () => {
  const layout = buildInvoiceLayout(sample(), { logoSize: { width: 384, height: 384 } });
  const text = layout.texts.join("\n");
  assert.match(text, /INVOICE/);
  assert.match(text, /The Gold Standard Limo/);
  assert.match(text, /Atlanta, GA/);
  assert.match(text, /TGS-1001/);
  assert.match(text, /\$125\.00/);
  assert.match(text, /Avery Cole/);
  assert.match(text, /avery@example\.test/);
  assert.match(text, /Hotel Indigo Atlanta/);
  assert.match(text, /Atlantic Station/);
  assert.match(text, /Stop 1/);
  assert.match(text, /Hartsfield-Jackson/);
  assert.match(text, /DL 1234/);
  assert.match(text, /Passengers/);
  assert.match(text, /Car service/);
  assert.match(text, /Amount due/);
  assert.match(text, /Cash App/);
  assert.match(text, /\$TGSLimo/);
  assert.match(text, /https:\/\/cash\.app\/\$TGSLimo\/125\.00/);
  assert.match(text, /Zelle/);
  assert.match(text, /Card accepted in the car/);
  assert.match(text, /Due on receipt/);
  assert.match(text, /Price does not include gratuity/);
  assert.ok(layout.logo);
  assert.equal(layout.logo.w, 140);
  assert.ok(layout.height >= 640);
  assert.equal(layout.commands.some((c) => c.type === "image"), true);
});

test("layout keeps markup characters as plain text and skips an unsafe logo URL", () => {
  const invoice = sample({
    business: {
      name: "<script>alert(1)</script>",
      address: '"><img src=x onerror=alert(1)>',
      paymentInstructions: "",
      terms: "",
      gratuityNote: "",
      logoDataUrl: "javascript:alert(1)",
    },
    billTo: { name: "<b>Eve</b>", phone: "", email: "" },
    payWith: [],
    payLines: [],
    trip: { date: "2026-11-18", time: "09:30", pickup: "<drop>", dropoff: "Airport", passengers: 1 },
  });
  const layout = buildInvoiceLayout(invoice);
  const text = layout.texts.join("\n");
  assert.match(text, /<script>alert\(1\)<\/script>/);
  assert.match(text, /<b>Eve<\/b>/);
  assert.match(text, /<drop>/);
  assert.equal(layout.texts.some((t) => t.includes("<img")), true);
  assert.equal(layout.logo, null);
  assert.equal(isSafeLogoDataUrl(invoice.business.logoDataUrl), false);
  assert.equal(isSafeLogoDataUrl("data:image/png;base64,iVBOR"), true);
  assert.equal(isSafeLogoDataUrl("data:text/html;base64,PHNjcmlwdD4="), false);
});

test("layout without pay methods uses how-to-pay fallback and still shows the total", () => {
  const layout = buildInvoiceLayout(sample({
    payWith: [],
    payLines: [],
    business: { name: "Solo Car", paymentInstructions: "", terms: "", gratuityNote: "", logoDataUrl: "" },
  }));
  const text = layout.texts.join("\n");
  assert.match(text, /How to pay/);
  assert.match(text, /Pay the operator directly/);
  assert.match(text, /\$125\.00/);
  assert.equal(layout.logo, null);
});

test("wrapLines breaks long words and blank lines", () => {
  const lines = wrapLines("one two\n\nsupercalifragilisticexpialidocious", 200, defaultMeasureText, 20);
  assert.ok(lines.includes("one two"));
  assert.equal(lines.includes(""), true);
  assert.ok(lines.length >= 4);
  assert.equal(lines.filter(Boolean).slice(1).join(""), "supercalifragilisticexpialidocious");
});

test("dates, filenames, and share copy stay short and sanitized", () => {
  assert.equal(formatIssued("2026-11-18"), "Wed, Nov 18, 2026");
  assert.equal(formatTime("09:30"), "9:30 AM");
  assert.equal(formatTime("00:05"), "12:05 AM");
  assert.equal(invoiceFileName({ number: "TGS-1001" }, "png"), "invoice-TGS-1001.png");
  assert.equal(invoiceFileName({ number: "../../evil name.pdf" }, "pdf"), "invoice-evil-name-pdf.pdf");
  assert.equal(invoiceFileName({ number: "" }, "png"), "invoice-invoice.png");
  const invoice = sample();
  assert.equal(invoiceShareTitle(invoice), "Invoice TGS-1001 from The Gold Standard Limo");
  const text = invoiceShareText(invoice);
  assert.match(text, /The Gold Standard Limo: invoice TGS-1001 for \$125\.00/);
  assert.match(text, /Pay with Cash App: https:\/\/cash\.app\/\$TGSLimo\/125\.00/);
  assert.match(text, /Thank you!/);
  assert.equal(text.includes("Nothing was sent automatically"), false);
  assert.equal(text.includes("Hotel Indigo"), false);
  assert.equal(cleanText("a\u0000b", 10), "ab");
});

test("mailto and sms fallbacks still carry the invoice text, not an attachment", () => {
  const links = invoiceSendLinks(sample());
  assert.match(links.mailto, /^mailto:avery@example\.test\?subject=/);
  assert.match(links.mailto, /Invoice%20TGS-1001/);
  assert.equal(links.mailto.includes("Nothing was sent automatically"), false);
  assert.match(links.sms, /^sms:\+?1?4045550199\?&body=/);
  const smsBody = decodeURIComponent(links.sms.split("body=")[1]);
  assert.match(smsBody, /Pay with:/);
  assert.match(smsBody, /cash\.app/);
  const noContact = invoiceSendLinks(sample({ billTo: { name: "Avery", phone: "", email: "not-an-email" } }));
  assert.equal(noContact.mailto, "");
  assert.equal(noContact.sms, "");
});

test("preferred share file is PDF for email and PNG for text", () => {
  const files = { png: { type: "image/png" }, pdf: { type: "application/pdf" } };
  assert.equal(preferredShareFile("email", files), files.pdf);
  assert.equal(preferredShareFile("text", files), files.png);
  assert.equal(preferredShareFile("email", { png: files.png }), files.png);
  assert.equal(preferredShareFile("text", { pdf: files.pdf }), files.pdf);
  assert.equal(preferredShareFile("email", null), null);
  assert.equal(canShareFile(null), false);
});

test("rgbToPdf writes a valid one-page PDF that inflates back to the pixels", async () => {
  const width = 3;
  const height = 2;
  const rgb = Uint8Array.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255,
    255, 255, 255, 0, 0, 0, 16, 32, 48,
  ]);
  const pdf = await rgbToPdf(width, height, rgb);
  const bytes = Buffer.from(pdf);
  const text = bytes.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Width 3/);
  assert.match(text, /\/Height 2/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /MediaBox \[0 0 612 /);
  assert.match(text, /startxref/);
  assert.match(text, /%%EOF\n$/);
  const streamAt = text.indexOf(">> stream\n", text.indexOf("/Subtype /Image"));
  assert.ok(streamAt > 0);
  const start = streamAt + ">> stream\n".length;
  const end = text.indexOf("\nendstream", start);
  const inflated = inflateSync(bytes.subarray(start, end));
  assert.deepEqual(Uint8Array.from(inflated), rgb);
});
