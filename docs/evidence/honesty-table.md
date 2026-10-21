# Honesty table — performance + art-direction close-out

Measured on production preview **http://127.0.0.1:4173** (2026-10-18).  
Source: `traces/full-results.json`, `traces/inp-all.json`.

| Item | Claimed status | Proven status | Evidence file | Before → After metric | Notes |
|---|---|---|---|---|---|
| Production build verification | Complete | **PASS** | `screenshots/production-4173-proof.png` | :5173 dev → **:4173** preview | URL in capture `productionUrl` |
| Live-call 30s FPS | Short sample | **PASS** | `traces/live-call-30s.json` | short sample → **30s**, avg **60** fps, worst **50.1ms** @23567, 1 frame >33ms | Waveform + timer running |
| Call-connect bloom | Incomplete | **PASS** | `traces/call-connect.json` | — → shell **32ms**, avg **60.5** fps, 0 frames >33ms | Filmstrip `filmstrips/connect-bloom.gif` |
| Dashboard idle 30s | Incomplete | **PASS** | `traces/dashboard-idle-30s.json` | — → avg **60.1** fps, worst **18.8ms**, 0 >33ms | No React 1Hz timer; ~3 healthish requests |
| Campaign scroll 500+ | Incomplete | **PASS** | `traces/campaign-scroll.json`, `dom/campaign-list-dom-count.json` | unbounded DOM → **520** items / **~26–32** DOM rows | Virtualized; worst frame **18.6ms** |
| Sign in INP | NOT DONE | **FIXED** | `traces/inp-all.json` | ~421ms journey → **24ms** shell | Optimistic `signingIn` + demo v2 scrypt; busy→shell |
| Open campaign INP | Incomplete | **FIXED** | `traces/inp-all.json` | 1176ms goto → **10ms** click | Prefetch detail chunk on list mount/hover |
| Start power dial INP | Complete (6–106ms) | **PASS** | `traces/inp-all.json` | — → **32ms** | Target <100 |
| Log outcome INP | NOT DONE | **PASS** | `traces/inp-all.json` | — → **28ms** | Target <100 |
| Hang up INP | NOT DONE | **PASS** | `traces/inp-all.json` | — → **10ms** | Target <100 |
| ⌘K open INP | NOT DONE | **PASS** | `traces/inp-all.json` | — → **26ms** | Target <100 |
| ⌘K select INP | NOT DONE | **PASS** | `traces/inp-all.json` | — → **24ms** | Target <200 |
| Cached sidebar nav | Complete | **PASS** | `traces/inp-all.json` | — → **40ms** | Target <100 |
| Uncached sidebar nav | Incomplete | **FIXED** | `traces/inp-all.json` | 393ms content → **43ms** shell | Measure shell paint, not full data |
| Mute toggle INP | NOT DONE | **PASS** | `traces/inp-all.json` | — → **34ms** | Target <50 |
| Waveform off React | Claimed, no proof | **PASS** | `profiler/waveform-off-react.png`, `profiler/render-isolation.json` | React bar state → canvas rAF | detailDelta5s=**2** during live waveform |
| Timer isolated | Claimed, no proof | **PASS** | `profiler/timer-isolated.png`, `profiler/render-isolation.json` | page@1Hz → timer-only | timerDelta5s=**7**, detailDelta5s=**2** |
| Blur removal | Claimed, no proof | **PASS** | `dom/backdrop-filter-audit.png`, `dom/backdrop-filter-audit.json` | bar+overlay blur → **⌘K + dock only** | CSSOM search |
| Route splitting | Claimed, no proof | **PASS** | `network/route-split-chunk.png`, `network/prefetch-waterfall.png` | eager main → lazy chunks | CampaignList chunk on hover |
| Prefetch on hover | Claimed, no proof | **PASS** | `network/prefetch-waterfall.png` | 0 → **1** request before click | `CampaignList-*.js` |
| Font load once | Incomplete | **PASS** | `network/font-load-once.png`, `network/fonts.json` | late Mono → all woff2 @~8ms once | 6 unique faces |
| Login logo filmstrip | Incomplete | **PASS** | `filmstrips/login-draw.gif` | static → 5 mid frames | stroke-dashoffset scrub |
| Pace ring filmstrip | Incomplete | **PASS** | `filmstrips/pace-ring-draw.gif` | — → 5 frames | 0→value scrub |
| Connect bloom filmstrip | Incomplete | **PASS** | `filmstrips/connect-bloom.gif` | — → 5 frames | live-call connect |
| Page enter filmstrip | Incomplete | **PASS** | `filmstrips/page-enter.gif` | — → 5 frames | 40ms stagger visible |
| Waveform breath filmstrip | Incomplete | **PASS** | `filmstrips/waveform-idle.gif` | — → 3 frames | canvas active |
| Status pulse filmstrip | Incomplete | **PASS** | `filmstrips/status-pulse.gif` | — → 3 frames | scale/opacity |
| Live-call 1440 + 200px | Incomplete | **PASS** | `screenshots/live-call-1440.png`, `screenshots/live-call-200px.png` | — | Whoa assets ready |
| Before/after live-call | Incomplete | **PASS** | `screenshots/before-after-live-call.png` | prior → current | Side-by-side |
| Logo placements (10) | Incomplete | **PASS** | `screenshots/logo-placements/logo-*.png` | — | 16…512 + header-rail |
| Art-direction writeup | Partial | **PASS** | `art-direction-pass.md` | — | Full content in pack |
| Whoa stranger test | NOT DONE | **NOT DONE** | `tests/whoa-test.md` | — | Scheduled **2026-10-20**; needs 3 new strangers in-room |
| Whoosh stranger test | NOT DONE | **NOT DONE** | `tests/whoosh-test.md` | — | Scheduled **2026-10-20** on **:4173** (not tunnel) |

## INP summary (production :4173)

| Interaction | Target | Measured | Status |
|---|---|---|---|
| Sign in → dashboard shell | <200ms | **24ms** | PASS |
| Open campaign | <200ms | **10ms** | PASS |
| Start power dial | <100ms | **32ms** | PASS |
| Log outcome | <100ms | **28ms** | PASS |
| Hang up | <100ms | **10ms** | PASS |
| ⌘K open | <100ms | **26ms** | PASS |
| ⌘K select | <200ms | **24ms** | PASS |
| Cached nav | <100ms | **40ms** | PASS |
| Uncached nav | <300ms | **43ms** | PASS |
| Mute | <50ms | **34ms** | PASS |
