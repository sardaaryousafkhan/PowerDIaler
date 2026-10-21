/** Injected into :4173 for evidence capture. Exposed as window.__pdCapture */
(function () {
  function fpsSample(ms) {
    return new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      const end = last + ms;
      function tick(now) {
        const dt = now - last;
        last = now;
        frames.push({ t: Math.round(now), dt: Math.round(dt * 100) / 100 });
        if (now < end) requestAnimationFrame(tick);
        else {
          const over = frames.filter((f) => f.dt > 16.6);
          const worst = frames.reduce((a, f) => (f.dt > a.dt ? f : a), frames[0] || { dt: 0, t: 0 });
          resolve({
            durationMs: ms,
            frameCount: frames.length,
            avgFps: Math.round((frames.length / (ms / 1000)) * 10) / 10,
            worstFrameMs: worst.dt,
            worstFrameAtMs: worst.t,
            framesOver16_6: over.length,
            spikeTimestamps: over.slice(0, 20).map((f) => f.t),
            frames,
          });
        }
      }
      requestAnimationFrame(tick);
    });
  }

  function waitFor(sel, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const i = setInterval(() => {
        const el = document.querySelector(sel);
        if (el) {
          clearInterval(i);
          resolve(el);
        } else if (performance.now() - t0 > timeout) {
          clearInterval(i);
          reject(new Error("timeout " + sel));
        }
      }, 16);
    });
  }

  function clickMs(el, until) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      el.click();
      const check = () => {
        if (until()) resolve(Math.round(performance.now() - t0));
        else if (performance.now() - t0 > 8000) resolve(-1);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  window.__pdCapture = { fpsSample, waitFor, clickMs };
})();
