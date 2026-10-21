import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
await page.goto("http://127.0.0.1:4173/login", { waitUntil: "networkidle0" });
await page.type('input[type="email"]', "owner@derivedstudio.com");
await page.type('input[type="password"]', "OwnerChangeMe123!");
const m = await page.evaluate(async () => {
  const btn = document.querySelector("button.primary");
  const t0 = performance.now();
  btn.click();
  await new Promise((r) => {
    const i = setInterval(() => {
      const onDash = location.pathname === "/dashboard";
      const shell =
        document.querySelector("h1") ||
        document.querySelector(".dash-page") ||
        document.querySelector(".route-shell-skeleton");
      if (onDash && shell) {
        clearInterval(i);
        r();
      }
    }, 8);
    setTimeout(() => {
      clearInterval(i);
      r();
    }, 5000);
  });
  return {
    ms: Math.round(performance.now() - t0),
    path: location.pathname,
    hasH1: !!document.querySelector("h1"),
    hasSkel: !!document.querySelector(".route-shell-skeleton"),
    hasDash: !!document.querySelector(".dash-page"),
  };
});
console.log(JSON.stringify(m));
await browser.close();
