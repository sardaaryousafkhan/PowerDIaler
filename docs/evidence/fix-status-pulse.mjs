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
const client = await page.createCDPSession();
await client.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});
await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
await page.type('input[type="email"]', "owner@derivedstudio.com");
await page.type('input[type="password"]', "OwnerChangeMe123!");
await page.click("button.primary");
await page.waitForFunction(() => location.pathname === "/dashboard", { timeout: 10000 });
await page.goto(BASE + "/campaigns/" + CID, { waitUntil: "networkidle0" });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /Start dialing|Resume|Start session/i.test(x.textContent || ""),
  );
  b?.click();
});
await page.waitForSelector(".live-call .status-dot", { timeout: 10000 });
for (let i = 0; i < 3; i++) {
  await page.evaluate((step) => {
    const dot = document.querySelector(".status-dot");
    if (!dot) return;
    const scale = 1 + step * 0.35;
    const opacity = 0.45 + step * 0.25;
    dot.style.transform = `scale(${scale})`;
    dot.style.opacity = String(opacity);
    const after = getComputedStyle(dot, "::after");
    void after;
  }, i);
  await new Promise((r) => setTimeout(r, 80));
  const box = await page.evaluate(() => {
    const el = document.querySelector(".status-dot");
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.x - 60)),
      y: Math.max(0, Math.floor(r.y - 40)),
      width: 220,
      height: 140,
    };
  });
  await page.screenshot({ path: path.join(ROOT, `filmstrips/status-pulse-f${i}.png`), clip: box });
}
console.log("status-pulse frames written");
await browser.close();
