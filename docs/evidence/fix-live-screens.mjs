import puppeteer from "puppeteer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:4173";
const CID = "cmv5flh3e000jzva7f5ctwba9";

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
await page.type('input[type="email"]', "owner@derivedstudio.com");
await page.type('input[type="password"]', "OwnerChangeMe123!");
await page.click("button.primary");
await page.waitForFunction(() => location.pathname === "/dashboard");
await page.goto(BASE + "/campaigns/" + CID, { waitUntil: "networkidle0" });
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((x) => /Start dialing|Resume/i.test(x.textContent || ""))
    ?.click();
});
await page.waitForSelector(".live-call", { timeout: 10000 });
await page.waitForSelector(".call-dock", { timeout: 5000 });
await page.evaluate(() => {
  document.querySelectorAll(".toast, [class*='toast']").forEach((el) => el.remove());
  document.querySelector(".live-call")?.scrollIntoView({ block: "center" });
});
await new Promise((r) => setTimeout(r, 600));
const box = await page.evaluate(() => ({
  live: !!document.querySelector(".live-call"),
  dock: !!document.querySelector(".call-dock"),
  hang: !!document.querySelector(".call-dock__btn--hang"),
  timer: document.body.innerText.match(/\d{2}:\d{2}/)?.[0],
  dockBottom: document.querySelector(".call-dock")?.getBoundingClientRect().bottom,
}));
console.log(box);
if (!box.live || !box.dock || !box.hang) {
  console.error("missing live-call chrome");
  process.exit(1);
}
await page.screenshot({ path: path.join(ROOT, "screenshots/live-call-1440.png") });

// Spec: 200px wide — scroll so timer + hang-up remain readable
await page.setViewport({ width: 200, height: 720, deviceScaleFactor: 1 });
await page.evaluate(() => {
  document.querySelectorAll(".toast, [class*='toast']").forEach((el) => el.remove());
  document.querySelector(".live-call__contact")?.scrollIntoView({ block: "start" });
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(ROOT, "screenshots/live-call-200px.png") });
console.log("written");
await browser.close();
