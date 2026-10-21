import puppeteer from "puppeteer";
const BASE = "http://127.0.0.1:4173";
const CID = "cmv5flh3e000jzva7f5ctwba9";
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("console", (m) => console.log("PAGE", m.text()));
await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
await page.type('input[type="email"]', "owner@derivedstudio.com");
await page.type('input[type="password"]', "OwnerChangeMe123!");
await page.click("button.primary");
await page.waitForFunction(() => location.pathname === "/dashboard", { timeout: 10000 });
await page.goto(BASE + "/campaigns/" + CID, { waitUntil: "networkidle0" });
const before = await page.evaluate(() => ({
  url: location.pathname,
  h1: document.querySelector("h1")?.textContent,
  buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).slice(0, 25),
  text: document.querySelector(".detail-stack")?.innerText?.slice(0, 900),
}));
console.log("BEFORE", JSON.stringify(before, null, 2));
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /Start dialing|Resume|Start session/i.test(x.textContent || ""),
  );
  b?.click();
  return b?.textContent?.trim() || null;
});
console.log("CLICKED", clicked);
for (const ms of [200, 500, 1000, 2000]) {
  await new Promise((r) => setTimeout(r, ms === 200 ? 200 : ms - (ms === 500 ? 200 : ms === 1000 ? 500 : 1000)));
  const snap = await page.evaluate(() => ({
    live: !!document.querySelector(".live-call"),
    chips: document.querySelectorAll(".disposition-chip").length,
    dock: !!document.querySelector(".call-dock"),
    toast: [...document.querySelectorAll(".toast, [class*=toast]")].map((t) => t.textContent).slice(0, 3),
    buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 15),
  }));
  console.log("T+" + ms, JSON.stringify(snap));
}
await page.screenshot({ path: "screenshots/debug-after-dial.png", fullPage: true });
await browser.close();
