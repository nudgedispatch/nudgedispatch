import assert from "node:assert/strict";
import test from "node:test";
import { publicWebsiteUrl, publicWebsiteLabel } from "../app/public-website.js";

test("publicWebsiteUrl normalizes bare domains and keeps explicit http(s) URLs", () => {
  assert.equal(publicWebsiteUrl("goldstandardlimo.com"), "https://goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("  goldstandardlimo.com  "), "https://goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("www.goldstandardlimo.com"), "https://www.goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("goldstandardlimo.com/book"), "https://goldstandardlimo.com/book");
  assert.equal(publicWebsiteUrl("//goldstandardlimo.com"), "https://goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("https://goldstandardlimo.com"), "https://goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("HTTPS://GoldStandardLimo.com"), "https://goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("http://goldstandardlimo.com"), "http://goldstandardlimo.com");
  assert.equal(publicWebsiteUrl("https://www.goldstandardlimo.com/about?ref=book#top"), "https://www.goldstandardlimo.com/about?ref=book#top");
});

test("publicWebsiteUrl renders nothing for blank, invalid, or unsafe values", () => {
  for (const value of [null, undefined, "", "   ", "not a url", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://goldstandardlimo.com", "mailto:hi@goldstandardlimo.com", "file:///etc/passwd", "https://", "http://", ".com", "https://user:pass@goldstandardlimo.com", "https://goldstandardlimo.com /path", "https://999.1.1.1"]) {
    assert.equal(publicWebsiteUrl(value), "", String(value));
  }
});

test("publicWebsiteLabel is the hostname, or blank when the URL is rejected", () => {
  assert.equal(publicWebsiteLabel("goldstandardlimo.com"), "goldstandardlimo.com");
  assert.equal(publicWebsiteLabel("https://www.goldstandardlimo.com/about"), "www.goldstandardlimo.com");
  assert.equal(publicWebsiteLabel("http://goldstandardlimo.com"), "goldstandardlimo.com");
  assert.equal(publicWebsiteLabel("javascript:alert(1)"), "");
  assert.equal(publicWebsiteLabel(""), "");
  assert.equal(publicWebsiteLabel(null), "");
});
