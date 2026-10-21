import puppeteer from "puppeteer";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4173/login", { waitUntil: "networkidle0" });
await page.type('input[type="email"]', "owner@derivedstudio.com");
await page.type('input[type="password"]', "OwnerChangeMe123!");
await page.click("button.primary");
await page.waitForFunction(() => location.pathname === "/dashboard");
await page.goto("http://127.0.0.1:4173/campaigns/cmv5flh3e000jzva7f5ctwba9", { waitUntil: "networkidle0" });
await page.evaluate(() => [...document.querySelectorAll("button")].find(x => /Start dialing|Resume/i.test(x.textContent||""))?.click());
await page.waitForSelector(".call-dock", { timeout: 10000 });
await page.evaluate(() => document.querySelectorAll(".toast,[class*=toast]").forEach(e => e.remove()));
// Keep 1440 as-is if already good; refresh 200 with hang in frame
await page.setViewport({ width: 200, height: 844, deviceScaleFactor: 1 });
await page.evaluate(() => {
  document.querySelector(".call-dock")?.scrollIntoView({ block: "end" });
  // also keep timer near top by scrolling contact into view then dock
  const live = document.querySelector(".live-call");
  if (live) live.scrollTop = live.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
});
await new Promise(r => setTimeout(r, 400));
// Compose: screenshot full then we'll check
await page.screenshot({ path: path.join(ROOT, "screenshots/live-call-200px.png") });
const vis = await page.evaluate(() => {
  const hang = document.querySelector(".call-dock__btn--hang");
  const timer = [...document.querySelectorAll("*")].find(el => /^\d{2}:\d{2}$/.test(el.textContent||""));
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, inView: b.top < innerHeight && b.bottom > 0 };
  };
  return { hang: r(hang), timer: r(timer), vh: innerHeight };
});
console.log(vis);
await browser.close();
