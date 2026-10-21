# Evidence pack — performance + art-direction close-out

Production build under test: **http://127.0.0.1:4173** (not :5173, not the Mac tunnel).

---

## 1. Is the app fast on production?

**Yes — instrumented production metrics pass.**

| Metric | Result |
|---|---|
| Live-call 30s avg FPS | **60** (`traces/live-call-30s.json`) |
| Live-call worst frame | **50.1ms** @ t=23567 (1 spike >33ms) |
| Call-connect shell | **32ms**; bloom sample 60.5 fps, 0 frames >33ms |
| Dashboard idle 30s | **60.1** avg fps; no React 1Hz re-render |
| Campaign scroll (520 rows) | worst **18.6ms**; DOM window **~26–32** nodes |
| All named INPs | **PASS** — see `honesty-table.md` / `traces/inp-all.json` |

Sign-in **24ms** to dashboard shell · Open campaign **10ms** · Start dial **32ms** · Log outcome **28ms** · Hang up **10ms** · ⌘K open/select **26/24ms** · Cached/uncached nav **40/43ms** · Mute **34ms**.

---

## 2. Is the app impressive to a stranger?

**No — not proven. Whoa test NOT DONE.**

Assets ready: `screenshots/live-call-1440.png`, `screenshots/live-call-200px.png`.  
Protocol + empty verbatim slots: `tests/whoa-test.md`.  
**Scheduled: 2026-10-20** (3 new strangers, no coaching, 5-second glance).

Self-assessment is not accepted for this row.

---

## 3. Is the app fast to a stranger?

**No — not proven. Whoosh test NOT DONE.**

Must run on the demo machine at **:4173**, not through the tunnel.  
Protocol + empty verbatim slots: `tests/whoosh-test.md`.  
**Scheduled: 2026-10-20** (same session as whoa; stopwatch first-click → live-call).

---

## 4. What is still not done, and when will it be?

| Gap | When |
|---|---|
| Whoa stranger test (3 people, verbatim) | **2026-10-20** |
| Whoosh stranger test (3 people, :4173, verbatim + timings) | **2026-10-20** |

Everything else in the required evidence layout is present in this pack (traces, filmstrip GIFs, screenshots, network/dom proofs, honesty table, art-direction writeup).

**Pass status: NOT CLOSED** — questions 2 and 3 are not clean passes until the scheduled stranger session completes.
