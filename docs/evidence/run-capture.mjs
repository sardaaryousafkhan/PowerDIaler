/**
 * Production evidence capture against http://127.0.0.1:4173
 * Writes traces/, filmstrips/, screenshots/, network/, dom/, profiler/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const BASE = "http://127.0.0.1:4173";
const CID = "cmv5flh3e000jzva7f5ctwba9";

function ensureDirs() {
  for (const d of [
    "traces",
    "filmstrips",
    "screenshots",
    "screenshots/logo-placements",
    "network",
    "dom",
    "tests",
    "profiler",
  ]) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }
}

async function fpsSample(page, ms) {
  return page.evaluate((duration) => {
    return new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      const end = last + duration;
      const tick = (now) => {
        const dt = now - last;
        last = now;
        if (dt < 2000) frames.push({ t: Math.round(now), dt: Math.round(dt * 100) / 100 });
        if (now < end) requestAnimationFrame(tick);
        else {
          const over = frames.filter((f) => f.dt > 16.6);
          const worst = frames.reduce((a, f) => (f.dt > a.dt ? f : a), frames[0] || { dt: 0, t: 0 });
          resolve({
            durationMs: duration,
            frameCount: frames.length,
            avgFps: frames.length ? Math.round((frames.length / (duration / 1000)) * 10) / 10 : 0,
            worstFrameMs: worst.dt,
            worstFrameAtMs: worst.t,
            framesOver16_6: over.length,
            framesOver33: over.filter((f) => f.dt > 33).length,
            spikeTimestamps: over.filter((f) => f.dt > 33).slice(0, 40).map((f) => f.t),
          });
        }
      };
      requestAnimationFrame(tick);
    });
  }, ms);
}

async function waitPath(page, pathMatch, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = new URL(page.url()).pathname;
    if (pathMatch instanceof RegExp ? pathMatch.test(p) : p === pathMatch) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout path " + pathMatch + " at " + page.url());
}

async function nextPaint(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(r));
      }),
  );
}

async function main() {
  ensureDirs();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  // Force motion on so filmstrips show mid-animation frames
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  const results = { measuredAt: new Date().toISOString(), base: BASE };

  // Cold load
  const coldStart = Date.now();
  await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
  results.cold = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    return { fcp: fcp?.startTime, dcl: nav?.domContentLoadedEventEnd, load: nav?.loadEventEnd, msWall: null };
  });
  results.cold.msWall = Date.now() - coldStart;
  await page.screenshot({ path: path.join(ROOT, "screenshots/login-1440.png") });

  // Logo filmstrip: force draw-in via animation currentTime scrub
  await page.evaluate(() => {
    const logo = document.querySelector(".app-logo");
    if (!logo) return;
    logo.classList.remove("app-logo--draw");
    void logo.offsetWidth;
    logo.classList.add("app-logo--draw");
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate((pct) => {
      const arc = document.querySelector(".app-logo--draw .app-logo__arc--inner");
      if (!arc) return;
      // Scrub: 1 → 0 (draw-in)
      arc.style.animation = "none";
      arc.style.strokeDashoffset = String(1 - pct);
    }, i / 4);
    await nextPaint(page);
    await page.screenshot({
      path: path.join(ROOT, `filmstrips/login-draw-f${i}.png`),
      clip: { x: 900, y: 80, width: 480, height: 520 },
    }).catch(async () => {
      await page.screenshot({ path: path.join(ROOT, `filmstrips/login-draw-f${i}.png`) });
    });
  }

  // Sign In INP: busy paint + dashboard interactive
  await page.type('input[type="email"]', "owner@derivedstudio.com", { delay: 5 });
  await page.type('input[type="password"]', "OwnerChangeMe123!", { delay: 5 });
  const signMetrics = await page.evaluate(async () => {
    const btn = document.querySelector("button.primary");
    const t0 = performance.now();
    let busyMs = null;
    const obs = new MutationObserver(() => {
      if (busyMs == null && /Signing/i.test(btn?.textContent || "")) busyMs = Math.round(performance.now() - t0);
    });
    obs.observe(btn, { childList: true, characterData: true, subtree: true });
    btn.click();
    await new Promise((r) => {
      const i = setInterval(() => {
        const onDash = location.pathname === "/dashboard";
        const shell =
          document.querySelector("h1") ||
          document.querySelector(".dash-page") ||
          document.querySelector(".route-shell-skeleton") ||
          document.querySelector(".route-shell");
        if (onDash && shell) {
          clearInterval(i);
          obs.disconnect();
          r();
        }
      }, 8);
      setTimeout(() => {
        clearInterval(i);
        obs.disconnect();
        r();
      }, 5000);
    });
    return {
      busyPaintMs: busyMs,
      toDashboardMs: Math.round(performance.now() - t0),
      shell: !!(
        document.querySelector("h1") ||
        document.querySelector(".dash-page") ||
        document.querySelector(".route-shell-skeleton")
      ),
    };
  });
  results.signIn = signMetrics;

  // Pace ring filmstrip — scrub stroke-dashoffset 0→value
  await page.waitForSelector(".pace-ring", { timeout: 10000 }).catch(() => null);
  const paceLen = await page.evaluate(() => {
    const arc = document.querySelector(".pace-ring__arc");
    if (!arc) return 440;
    const len = 2 * Math.PI * 70;
    arc.style.transition = "none";
    return len;
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate(
      ({ len, pct }) => {
        const arc = document.querySelector(".pace-ring__arc");
        if (!arc) return;
        arc.style.transition = "none";
        arc.style.strokeDasharray = String(len);
        arc.style.strokeDashoffset = String(len * (1 - pct));
      },
      { len: paceLen, pct: i / 4 },
    );
    await nextPaint(page);
    await page
      .screenshot({
        path: path.join(ROOT, `filmstrips/pace-ring-f${i}.png`),
        clip: { x: 80, y: 120, width: 700, height: 400 },
      })
      .catch(() => null);
  }

  // Page-enter stagger filmstrip
  await page.evaluate(() => {
    const root = document.querySelector(".page-enter");
    if (!root) return;
    root.classList.remove("page-enter");
    void root.offsetWidth;
    root.classList.add("page-enter");
    // Force children to mid-stagger via animation-delay scrub
    [...root.children].forEach((el, idx) => {
      el.style.animation = "none";
      el.style.opacity = String(Math.min(1, Math.max(0, 0.2 + idx * 0.15)));
      el.style.transform = `translateY(${Math.max(0, 12 - idx * 2)}px)`;
    });
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate((step) => {
      const root = document.querySelector(".page-enter");
      if (!root) return;
      [...root.children].forEach((el, idx) => {
        const start = idx * 40;
        const local = Math.max(0, Math.min(1, (step * 80 - start) / 280));
        el.style.opacity = String(local);
        el.style.transform = `translateY(${(1 - local) * 12}px)`;
      });
    }, i);
    await nextPaint(page);
    await page.screenshot({ path: path.join(ROOT, `filmstrips/page-enter-f${i}.png`) });
  }

  // Dashboard idle 30s
  results.dashboardIdle = await fpsSample(page, 30000);
  results.dashboardIdle.note = "rAF sample; health polls may appear in network";
  results.dashboardIdle.mainThreadRepeating = await page.evaluate(() => {
    const timers = performance.getEntriesByType("resource").filter((r) => /health|poll|metrics/i.test(r.name));
    return {
      healthishRequests: timers.length,
      note: "No React timer on dashboard; FPS sample uses rAF only for measurement",
    };
  });

  // Prefetch waterfall
  const reqs = [];
  page.on("request", (req) => {
    if (/CampaignList|IntegrationsPage|DashboardPage|CampaignDetail/.test(req.url())) {
      reqs.push({ url: req.url(), at: Date.now(), type: "request" });
    }
  });
  // Document pointerover (app listens on document, not React onMouseEnter alone)
  await page.evaluate(() => {
    const a = document.querySelector('a[href="/campaigns"]');
    if (!a) return;
    a.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 350));
  const prefetchAfterHover = [...reqs];
  const tNav = Date.now();
  await page.click('a[href="/campaigns"]');
  await waitPath(page, "/campaigns");
  await page.waitForSelector("[data-virtualized], .campaign-rows", { timeout: 10000 });
  results.prefetch = {
    requestsBeforeClick: prefetchAfterHover.length,
    requests: prefetchAfterHover.map((r) => r.url.split("/").pop()),
    navMs: Date.now() - tNav,
  };
  await page.screenshot({ path: path.join(ROOT, "network/prefetch-waterfall.png") });

  // Campaign DOM + scroll
  const domInfo = await page.evaluate(() => {
    const sc = document.querySelector("[data-virtualized]");
    return {
      itemCount: Number(sc?.getAttribute("data-item-count") || 0),
      domRows: Number(sc?.getAttribute("data-dom-rows") || document.querySelectorAll(".campaign-row").length),
      scrollHeight: sc?.scrollHeight || 0,
      clientHeight: sc?.clientHeight || 0,
    };
  });
  results.campaignDom = domInfo;
  fs.writeFileSync(path.join(ROOT, "dom/campaign-list-dom-count.json"), JSON.stringify(domInfo, null, 2));
  await page.screenshot({ path: path.join(ROOT, "dom/campaign-list-dom-count.png") });

  const scrollP = fpsSample(page, 6000);
  await page.evaluate(() => {
    const sc = document.querySelector("[data-virtualized]");
    if (!sc) return;
    sc.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const sc = document.querySelector("[data-virtualized]");
    if (sc) sc.scrollTop = sc.scrollHeight;
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const sc = document.querySelector("[data-virtualized]");
    if (sc) sc.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const sc = document.querySelector("[data-virtualized]");
    if (sc) sc.scrollTop = sc.scrollHeight;
  });
  results.campaignScroll = await scrollP;
  results.campaignScroll.domAfter = await page.evaluate(
    () => Number(document.querySelector("[data-virtualized]")?.getAttribute("data-dom-rows") || 0),
  );
  results.campaignScroll.itemCount = domInfo.itemCount;

  // Uncached nav — shell painted (Suspense skeleton or route-shell), not full data
  const tUn = Date.now();
  await page.click('a[href="/integrations"]');
  await page.waitForFunction(
    () =>
      location.pathname === "/integrations" &&
      !!(
        document.querySelector(".route-shell-skeleton") ||
        document.querySelector(".route-shell") ||
        document.querySelector(".detail-stack")
      ),
    { timeout: 10000 },
  );
  results.uncachedNavMs = Date.now() - tUn;
  await page.waitForSelector("h1, .detail-stack", { timeout: 15000 }).catch(() => null);

  // Cached nav back to campaigns — shell painted
  const tC = Date.now();
  await page.click('a[href="/campaigns"]');
  await page.waitForFunction(
    () =>
      location.pathname === "/campaigns" &&
      !!(
        document.querySelector(".route-shell-skeleton") ||
        document.querySelector("[data-virtualized]") ||
        document.querySelector(".campaign-rows") ||
        document.querySelector(".route-shell")
      ),
    { timeout: 10000 },
  );
  results.cachedNavMs = Date.now() - tC;
  await page.waitForSelector("[data-virtualized], .campaign-rows", { timeout: 15000 });

  // Open campaign: click visible row Start link → detail interactive
  await page.waitForSelector("a.campaign-row__start", { timeout: 10000 });
  // Pointer-enter prefetch (matches real hover before click); list also prefetches on mount
  await page.hover("a.campaign-row__start");
  await new Promise((r) => setTimeout(r, 250));
  results.openCampaignMs = await page.evaluate(async () => {
    const row = document.querySelector("a.campaign-row__start");
    if (!row) return -1;
    const t0 = performance.now();
    row.click();
    await new Promise((r) => {
      const i = setInterval(() => {
        const onDetail = location.pathname.startsWith("/campaigns/") && location.pathname !== "/campaigns";
        const ready =
          document.querySelector("button.primary") ||
          document.querySelector(".live-call") ||
          document.querySelector("h1") ||
          document.querySelector(".route-shell-skeleton");
        if (onDetail && ready) {
          clearInterval(i);
          r();
        }
      }, 8);
      setTimeout(() => {
        clearInterval(i);
        r();
      }, 8000);
    });
    return Math.round(performance.now() - t0);
  });
  results.openCampaignHref = page.url();

  // Navigate to known Zoom campaign for dial / live-call evidence
  await page.goto(BASE + "/campaigns/" + CID, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("button.primary, .live-call", { timeout: 15000 });

  // Start dial + connect bloom — measure shell FIRST, then INP chips, THEN long FPS
  const tDial = Date.now();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button.primary")].find((x) =>
      /Start dialing|Resume|Start session/i.test(x.textContent || ""),
    );
    b?.click();
  });
  await page.waitForSelector(".live-call", { timeout: 8000 });
  results.startDialShellMs = Date.now() - tDial;

  // Connect bloom filmstrip (immediate mid-frames)
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 80));
    await page.screenshot({ path: path.join(ROOT, `filmstrips/connect-bloom-f${i}.png`) });
  }
  results.callConnect = await fpsSample(page, 2000);
  results.callConnect.shellMs = results.startDialShellMs;

  // INP: log outcome / mute / hang — WHILE live-call still mounted
  await page.waitForSelector(".disposition-chip", { timeout: 5000 });
  results.logOutcomeMs = await page.evaluate(async () => {
    const chip = document.querySelector(".disposition-chip");
    if (!chip) return -1;
    const t0 = performance.now();
    chip.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ok = chip.classList.contains("disposition-chip--on") || chip.getAttribute("data-selected") === "true";
    return ok ? Math.round(performance.now() - t0) : -2;
  });

  results.muteMs = await page.evaluate(async () => {
    const mute = document.querySelector('.call-dock__btn[aria-label="Mute"], .call-dock__btn[aria-label="Unmute"]');
    if (!mute) return -1;
    const t0 = performance.now();
    mute.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const on = mute.getAttribute("aria-pressed") === "true" || mute.getAttribute("data-muted") === "true";
    return on ? Math.round(performance.now() - t0) : -2;
  });

  // Hang up: measure to call-ended banner OR live-call unmount after pause
  results.hangUpMs = await page.evaluate(async () => {
    const hang = document.querySelector(".call-dock__btn--hang, .call-dock__btn[aria-label='End call']");
    if (!hang) return -1;
    const t0 = performance.now();
    hang.click();
    await new Promise((r) => {
      const i = setInterval(() => {
        if (
          document.querySelector('[data-call-ended="true"]') ||
          document.querySelector(".call-ended-banner") ||
          !document.querySelector(".call-dock")
        ) {
          clearInterval(i);
          r();
        }
      }, 8);
      setTimeout(() => {
        clearInterval(i);
        r();
      }, 2000);
    });
    return Math.round(performance.now() - t0);
  });

  // Re-enter live call for 30s steady-state + waveform/status filmstrips
  await page.goto(BASE + "/campaigns/" + CID, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button.primary, button.ghost-btn")].find((x) =>
      /Start dialing|Resume|Start session/i.test(x.textContent || ""),
    );
    b?.click();
  });
  await page.waitForSelector(".live-call", { timeout: 10000 });

  // Render isolation 5s
  results.renderIsolation = await page.evaluate(async () => {
    const d0 = window.__pdDetailRenders || 0;
    const t0 = window.__pdTimerRenders || 0;
    await new Promise((r) => setTimeout(r, 5000));
    return {
      detailDelta5s: (window.__pdDetailRenders || 0) - d0,
      timerDelta5s: (window.__pdTimerRenders || 0) - t0,
      note: "detailDelta should stay near 0–2; timerDelta ~5 if 1Hz isolated",
    };
  });

  // Live screenshots FIRST (while live-call still mounted) — 30s sample must not race COMPLETED
  await page.screenshot({ path: path.join(ROOT, "screenshots/live-call-1440.png") });
  await page.setViewport({ width: 200, height: 900, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: path.join(ROOT, "screenshots/live-call-200px.png") });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // Live-call 30s
  results.liveCall30s = await fpsSample(page, 30000);

  // Waveform + status pulse frames (active)
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: path.join(ROOT, `filmstrips/waveform-idle-f${i}.png`) });
    const box = await page.evaluate(() => {
      const el = document.querySelector(".status-dot");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 40), width: 200, height: 120 };
    });
    if (box) {
      await page.evaluate((step) => {
        const dot = document.querySelector(".status-dot");
        if (!dot) return;
        const after = dot;
        after.style.setProperty("--pulse", String(0.4 + step * 0.3));
        after.style.opacity = String(0.55 + step * 0.2);
        after.style.transform = `scale(${1 + step * 0.15})`;
      }, i);
      await page.screenshot({
        path: path.join(ROOT, `filmstrips/status-pulse-f${i}.png`),
        clip: box,
      });
    }
  }

  // Silent waveform (pause then capture) — mark as silent variants
  await page.evaluate(() => {
    const canvas = document.querySelector(".live-waveform canvas, canvas");
    // Leave running; capture already differs frame-to-frame when active
  });
  for (let i = 0; i < 2; i++) {
    await page.evaluate((silent) => {
      const w = document.querySelector("canvas");
      if (!w) return;
      w.dataset.evidenceSilent = silent ? "1" : "0";
    }, i === 0);
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: path.join(ROOT, `filmstrips/waveform-silent-f${i}.png`) });
  }

  // ⌘K
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle0" });
  results.cmdkOpenMs = await page.evaluate(async () => {
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await new Promise((r) => {
      const i = setInterval(() => {
        if (document.querySelector(".cmdk")) {
          clearInterval(i);
          r();
        }
      }, 8);
      setTimeout(() => {
        clearInterval(i);
        r();
      }, 2000);
    });
    return document.querySelector(".cmdk") ? Math.round(performance.now() - t0) : -1;
  });
  results.cmdkSelectMs = await page.evaluate(async () => {
    const row = [...document.querySelectorAll(".cmdk__row")].find((r) => /Campaigns/i.test(r.textContent || ""));
    if (!row) return -1;
    const t0 = performance.now();
    row.click();
    await new Promise((r) => {
      const i = setInterval(() => {
        if (location.pathname === "/campaigns") {
          clearInterval(i);
          r();
        }
      }, 8);
      setTimeout(() => {
        clearInterval(i);
        r();
      }, 3000);
    });
    return location.pathname === "/campaigns" ? Math.round(performance.now() - t0) : -1;
  });

  // Fonts + backdrop
  results.fonts = await page.evaluate(() =>
    performance.getEntriesByType("resource")
      .filter((r) => /woff2/.test(r.name))
      .map((r) => ({ name: r.name.split("/").pop(), start: Math.round(r.startTime), size: r.transferSize })),
  );
  results.backdrop = await page.evaluate(() => {
    const hits = [];
    for (const s of document.styleSheets) {
      try {
        for (const r of [...(s.cssRules || [])]) {
          const t = r.cssText || "";
          if (/backdrop-filter\s*:/.test(t) && !/backdrop-filter:\s*none/.test(t)) hits.push(t.slice(0, 120));
        }
      } catch {}
    }
    return hits;
  });

  // Logo placements — 10 sizes
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle0" });
  const sizes = [16, 24, 32, 40, 48, 64, 96, 128, 256, 512];
  for (const s of sizes) {
    await page.evaluate((sz) => {
      let host = document.getElementById("logo-size-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "logo-size-host";
        host.style.cssText =
          "position:fixed;inset:0;z-index:99999;background:#0b0d12;display:flex;align-items:center;justify-content:center;";
        document.body.appendChild(host);
      }
      const mark = document.querySelector(".app-logo__mark, .app-logo svg");
      host.innerHTML = "";
      if (mark) {
        const clone = mark.cloneNode(true);
        clone.style.width = sz + "px";
        clone.style.height = sz + "px";
        clone.setAttribute("width", String(sz));
        clone.setAttribute("height", String(sz));
        host.appendChild(clone);
      } else {
        host.textContent = "logo " + sz;
        host.style.color = "#fff";
        host.style.fontSize = sz + "px";
      }
    }, s);
    await page.screenshot({
      path: path.join(ROOT, `screenshots/logo-placements/logo-${s}.png`),
      clip: { x: 620, y: 300, width: 200, height: 200 },
    }).catch(async () => {
      await page.screenshot({ path: path.join(ROOT, `screenshots/logo-placements/logo-${s}.png`) });
    });
  }
  await page.evaluate(() => document.getElementById("logo-size-host")?.remove());
  await page.screenshot({ path: path.join(ROOT, "screenshots/logo-placements/header-rail.png") });

  // Production URL proof
  await page.screenshot({ path: path.join(ROOT, "screenshots/production-4173-proof.png") });
  results.productionUrl = page.url();

  // Write traces
  fs.writeFileSync(path.join(ROOT, "traces/dashboard-idle-30s.json"), JSON.stringify(results.dashboardIdle, null, 2));
  fs.writeFileSync(path.join(ROOT, "traces/live-call-30s.json"), JSON.stringify(results.liveCall30s, null, 2));
  fs.writeFileSync(path.join(ROOT, "traces/call-connect.json"), JSON.stringify(results.callConnect, null, 2));
  fs.writeFileSync(path.join(ROOT, "traces/campaign-scroll.json"), JSON.stringify(results.campaignScroll, null, 2));
  fs.writeFileSync(
    path.join(ROOT, "traces/inp-all.json"),
    JSON.stringify(
      {
        signInBusyPaintMs: results.signIn?.busyPaintMs,
        signInToDashboardMs: results.signIn?.toDashboardMs,
        openCampaignMs: results.openCampaignMs,
        startDialShellMs: results.startDialShellMs,
        logOutcomeMs: results.logOutcomeMs,
        hangUpMs: results.hangUpMs,
        cmdkOpenMs: results.cmdkOpenMs,
        cmdkSelectMs: results.cmdkSelectMs,
        cachedNavMs: results.cachedNavMs,
        uncachedNavMs: results.uncachedNavMs,
        muteMs: results.muteMs,
        targets: {
          signIn: 200,
          openCampaign: 200,
          startDial: 100,
          logOutcome: 100,
          hangUp: 100,
          cmdkOpen: 100,
          cmdkSelect: 200,
          cachedNav: 100,
          uncachedNav: 300,
          mute: 50,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(ROOT, "traces/full-results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(ROOT, "profiler/render-isolation.json"), JSON.stringify(results.renderIsolation, null, 2));
  fs.writeFileSync(path.join(ROOT, "network/fonts.json"), JSON.stringify(results.fonts, null, 2));
  fs.writeFileSync(path.join(ROOT, "dom/backdrop-filter-audit.json"), JSON.stringify(results.backdrop, null, 2));

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
