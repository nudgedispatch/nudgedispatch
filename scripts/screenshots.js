import puppeteer from "puppeteer-core";

const base = process.argv[2] || "http://127.0.0.1:8787";
const dir = process.argv[3] || "/opt/cursor/artifacts";
const prefix = process.argv[4] || "before";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

async function shot(name) {
  await new Promise((r) => setTimeout(r, 400));
  const path = `${dir}/${prefix}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(path, page.url());
}

await page.goto(base + "/#/login", { waitUntil: "networkidle0" });
await shot("sign-in");

await page.type("#email", "operator@example.test");
await page.type("#password", "sample-operator-1");
await Promise.all([
  page.waitForFunction(() => location.hash.startsWith("#/rides") && !location.hash.includes("/rides/")),
  page.click("button[type=submit]"),
]);
await page.waitForSelector(".list-btn, .title");
await shot("rides");

await page.click("[data-id='66666666-6666-4666-8666-666666666666']");
await page.waitForFunction(() => location.hash.includes("/rides/"));
await page.waitForSelector("article.card, .times");
await shot("ride-detail");

await page.goto(base + "/#/settings/rates", { waitUntil: "networkidle0" });
await page.waitForSelector("#rates, #tryq");
await shot("rate-quote");

await page.evaluate(() => { document.cookie = "nudge_session=; Path=/; Max-Age=0"; });
await page.goto(base + "/#/login", { waitUntil: "networkidle0" });
await page.waitForSelector("#email");
await page.type("#email", "admin@example.test");
await page.type("#password", "sample-admin-pass");
await Promise.all([
  page.waitForFunction(() => location.hash.startsWith("#/admin")),
  page.click("button[type=submit]"),
]);
await page.waitForSelector("#invite, #accounts");
await shot("admin");

await browser.close();
