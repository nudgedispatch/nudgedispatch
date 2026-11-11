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

async function clearSession() {
  const cookies = await page.cookies();
  if (cookies.length) await page.deleteCookie(...cookies);
}

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
  page.click("#f button[type=submit]"),
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

await clearSession();
await page.goto(base + "/#/login", { waitUntil: "networkidle0" });
await page.waitForSelector("#email");
await page.type("#email", "admin@example.test");
await page.type("#password", "sample-admin-pass");
await Promise.all([
  page.waitForFunction(() => location.hash.startsWith("#/admin")),
  page.click("#f button[type=submit]"),
]);
await page.waitForSelector("#invite, #accounts");
await shot("admin");

await clearSession();
await page.goto(base + "/#/login", { waitUntil: "networkidle0" });
await page.waitForSelector("#login-switch");
await page.click("#login-switch");
await page.waitForSelector("#driver-login:not(.hidden)");
await shot("driver-signin");

await page.click("#login-switch");
await page.waitForSelector("#email");
await page.type("#email", "fleet@example.test");
await page.type("#password", "sample-fleet-pass");
await Promise.all([
  page.waitForFunction(() => location.hash.startsWith("#/rides")),
  page.click("#f button[type=submit]"),
]);
await page.click("[data-go='#/settings']");
await page.waitForSelector("#add-driver");
await page.waitForFunction(() => document.body.innerText.includes("Riley Cole"));
await shot("drivers");
await page.evaluate(() => {
  for (const el of document.querySelectorAll(".top, .tabs")) el.style.display = "none";
  document.body.style.paddingBottom = "0px";
});
const driversCard = await page.$("#drivers-card");
await driversCard.screenshot({ path: `${dir}/${prefix}-drivers-card.png` });
console.log(`${dir}/${prefix}-drivers-card.png`);

await page.type("#driver-name", "Jordan Blake");
await page.type("#driver-vehicle", "Sedan");
await page.type("#driver-plate", "NEW200");
await page.click("#add-driver button[type=submit]");
await page.waitForFunction(() => document.body.innerText.includes("Jordan Blake"));
await page.waitForSelector("[data-passcode-for]");

const riley = await page.evaluateHandle(() => [...document.querySelectorAll(".driver-row")].find((row) => row.innerText.includes("Riley Cole")));
await riley.$eval("[name=vehicle]", (input) => {
  input.value = "Sprinter";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await riley.$eval("[name=plate]", (input) => {
  input.value = "ATL2042";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await (await riley.$("form.edit-driver button[type=submit]")).click();
await page.waitForFunction(() => document.body.innerText.includes("Sprinter") && document.body.innerText.includes("ATL2042"));

const jordan = await page.evaluateHandle(() => [...document.querySelectorAll(".driver-row")].find((row) => row.innerText.includes("Jordan Blake")));
await jordan.$eval("[name=passcode]", (input) => {
  input.value = "ride22";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await (await jordan.$("form.passcode-driver button[type=submit]")).click();
await page.waitForFunction(() => document.body.innerText.includes("Passcode saved"));
await shot("drivers-saved");
await page.evaluate(() => {
  for (const el of document.querySelectorAll(".top, .tabs")) el.style.display = "none";
  document.body.style.paddingBottom = "0px";
});
const savedCard = await page.$("#drivers-card");
await savedCard.screenshot({ path: `${dir}/${prefix}-drivers-saved-card.png` });
console.log(`${dir}/${prefix}-drivers-saved-card.png`);

await browser.close();
