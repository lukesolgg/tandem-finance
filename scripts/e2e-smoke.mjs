/**
 * Browser smoke test against a running server: two people, real Chrome.
 *   BASE=http://localhost:3100 CHROME=/usr/bin/google-chrome OUT=./shots node scripts/e2e-smoke.mjs
 * Requires a fresh database (sign-up is only open for the first user).
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.OUT ?? "./shots";
const FIX = process.env.FIX ?? "tests/fixtures";
const PDFS = process.env.PDFS ?? OUT;
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });

async function newPage(ctx, viewport) {
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push(`console: ${m.text()}`));
  page.on("dialog", (d) => d.accept());
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const go = async (page, p) => {
  await page.goto(BASE + p, { waitUntil: "networkidle0" });
};
async function fill(page, sel, value) {
  await page.waitForSelector(sel);
  await page.$eval(sel, (el) => (el.value = ""));
  await page.type(sel, value);
}
async function clickText(page, text, scope = "") {
  const h = await page.waitForSelector(`::-p-xpath(${scope}//*[self::button or self::a][contains(normalize-space(.), "${text}")])`, { timeout: 15000 });
  await h.click();
}
const step = (s) => console.log("→", s);

// ── Person A on a phone ─────────────────────────────────────────────────────
const ctxA = await browser.createBrowserContext();
const a = await newPage(ctxA, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

step("sign up");
await go(a, "/signup");
await shot(a, "01-signup");
await fill(a, "input[name=name]", "Luke");
await fill(a, "input[name=pin]", "27183141");
await fill(a, "input[name=pinConfirm]", "27183141");
await Promise.all([a.waitForNavigation({ waitUntil: "networkidle0" }), clickText(a, "Create household")]);
await shot(a, "02-onboarding");

async function addAccount(bank, owner, visibility, name) {
  await go(a, "/accounts");
  await clickText(a, "Add account");
  await a.waitForSelector("dialog[open] select");
  await a.select("dialog[open] select", bank);
  if (name) await fill(a, "dialog[open] input:not([inputmode])", name);
  if (owner === "joint") await clickText(a, "Joint", "//dialog[@open]");
  if (visibility) await clickText(a, visibility, "//dialog[@open]");
  await clickText(a, "Add account", "//dialog[@open]//form");
  await a.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 15000 });
}
step("add accounts");
await addAccount("monzo", "me", null, "Monzo");
await addAccount("vanquis", "me", "Private", "Vanquis card");
await addAccount("starling", "joint", null, "Joint Starling");
await go(a, "/accounts");
await shot(a, "03-accounts");

async function importFile(accountName, file) {
  await go(a, "/import");
  const value = await a.$$eval("select option", (os, n) => os.find((o) => o.textContent.startsWith(n))?.value, accountName);
  await a.select("select", value);
  const input = await a.$("input[type=file]");
  await input.uploadFile(file);
  await a.waitForSelector("::-p-xpath(//button[starts-with(normalize-space(.), 'Import ')] | //*[contains(., \"Couldn't read\")])", { timeout: 30000 });
}
step("import Monzo CSV");
await importFile("Monzo", path.join(FIX, "monzo.csv"));
await shot(a, "04-import-review");
await clickText(a, "Import 5");
await a.waitForSelector("::-p-xpath(//*[contains(., 'transactions imported')])", { timeout: 20000 });
step("import joint Starling CSV");
await importFile("Joint Starling", path.join(FIX, "starling.csv"));
await clickText(a, "Import 5");
await a.waitForSelector("::-p-xpath(//*[contains(., 'transactions imported')])", { timeout: 20000 });
step("import Vanquis PDF");
await importFile("Vanquis card", path.join(PDFS, "vanquis.pdf"));
await shot(a, "05-import-pdf-review");
await clickText(a, "Import 3");
await a.waitForSelector("::-p-xpath(//*[contains(., 'transactions imported')])", { timeout: 20000 });

step("transactions + detail sheet");
await go(a, "/transactions");
await shot(a, "06-transactions");
await clickText(a, "Argos Ltd");
await a.waitForSelector("dialog[open]");
await new Promise((r) => setTimeout(r, 300));
await a.screenshot({ path: path.join(OUT, "07-txn-detail.png") });
await a.keyboard.press("Escape");

step("budget for October");
await go(a, "/budgets?period=2026-10");
await clickText(a, "Add a category");
await a.waitForSelector("dialog[open] select");
const groceries = await a.$$eval("dialog[open] select option", (os) => os.find((o) => o.textContent.includes("Groceries"))?.value);
await a.select("dialog[open] select", groceries);
await fill(a, "dialog[open] input[inputmode=decimal]", "300");
await clickText(a, "Save", "//dialog[@open]");
await a.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 15000 });
await go(a, "/budgets?period=2026-10");
await shot(a, "08-budgets");

step("goal");
await go(a, "/goals");
await clickText(a, "New goal");
await fill(a, "dialog[open] input[required]:not([inputmode])", "Kraków trip");
await fill(a, "dialog[open] input[inputmode=decimal]", "2000");
await a.$eval("dialog[open] input[type=date]", (el) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, "2027-05-01");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await clickText(a, "Create goal", "//dialog[@open]");
await a.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 15000 });
await go(a, "/goals");
await shot(a, "09-goals");

step("review + dashboard");
await go(a, "/review");
await shot(a, "10-review");
await go(a, "/");
await shot(a, "11-dashboard-mobile");

step("invite partner");
await go(a, "/settings");
await clickText(a, "Create invite link");
await a.waitForSelector("input[readonly]");
const inviteUrl = await a.$eval("input[readonly]", (el) => el.value);
await shot(a, "12-settings");

// ── Partner on desktop ──────────────────────────────────────────────────────
const ctxB = await browser.createBrowserContext();
const b = await newPage(ctxB, { width: 1280, height: 860 });
step("partner joins");
await b.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle0" });
await shot(b, "13-invite");
await fill(b, "input[name=name]", "Julia");
await fill(b, "input[name=pin]", "31415926");
await fill(b, "input[name=pinConfirm]", "31415926");
await Promise.all([b.waitForNavigation({ waitUntil: "networkidle0" }), clickText(b, "Join household")]);

step("privacy checks");
await go(b, "/transactions");
const partnerText = await b.$eval("main", (m) => m.innerText);
const checks = {
  "partner sees Luke's shared Monzo": partnerText.includes("Pret A Manger"),
  "partner sees joint Starling": partnerText.includes("Sainsbury"),
  "partner does NOT see private Vanquis": !partnerText.includes("Argos"),
};
await shot(b, "14-partner-transactions");
await go(b, "/accounts");
checks["partner accounts list hides Vanquis"] = !(await b.$eval("main", (m) => m.innerText)).includes("Vanquis");
await go(b, "/review?period=2026-10");
await shot(b, "15-partner-review-desktop");
await go(b, "/budgets?period=2026-10");
await shot(b, "16-partner-budgets-desktop");

// Dark mode
await b.evaluate(() => { localStorage.setItem("theme", "dark"); });
await go(b, "/");
await shot(b, "17-dashboard-dark-desktop");

// Sign in on a new phone: pick name, wrong PIN, then right PIN
step("PIN sign-in on a new device");
const c = await newPage(await browser.createBrowserContext(), { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await go(c, "/login");
checks["login shows both names"] = await c.$eval("main", (m) => m.innerText.includes("Luke") && m.innerText.includes("Julia"));
await clickText(c, "Luke");
await fill(c, "input[name=pin]", "11111112");
await clickText(c, "Sign in");
await c.waitForSelector("::-p-xpath(//*[contains(., 'tries left')])", { timeout: 15000 });
await shot(c, "18-login-wrong-pin");
await fill(c, "input[name=pin]", "27183141");
await Promise.all([c.waitForNavigation({ waitUntil: "networkidle0" }), clickText(c, "Sign in")]);
checks["right PIN signs in"] = new URL(c.url()).pathname === "/";

// Unauthenticated access is redirected
const anon = await newPage(await browser.createBrowserContext(), { width: 800, height: 600 });
await anon.goto(BASE + "/transactions", { waitUntil: "networkidle0" });
checks["anonymous redirected to login"] = anon.url().includes("/login");
const exportRes = await anon.goto(BASE + "/api/export");
checks["anonymous export is 401"] = exportRes.status() === 401;

await browser.close();
console.log(JSON.stringify({ checks, errors }, null, 2));
process.exit(Object.values(checks).every(Boolean) && errors.length === 0 ? 0 : 1);
