# Evidence table (self-honesty)

**Measurement environment:** `pnpm --filter @powerdialer/web build && vite preview` → `http://127.0.0.1:4173`  
**Not measured:** Vite `dev` on `:5173` (HMR). That was the prior “demo” and **inflates** perceived slowness.

| Item | Claimed (prior checklist) | Proven status | Evidence file | Before → After metric | Notes |
|---|---|---|---|---|---|
| Production build used for perf | implied | **PASS** | `traces/prod-baseline-summary.json` | n/a → `:4173` preview | Dev mode was the silent amplifier |
| Press-on-pointer-down | PASS | **FIXED→PASS** | `traces/prod-baseline-summary.json` | unmeasured → **14ms** to `data-pressed` | Document capture `pointerdown` + CSS |
| Optimistic Start Dialing | PASS | **FIXED→PASS** | same | unmeasured → **6ms** to `.live-call` in DOM | Optimistic status + isolated timer |
| Route prefetch on hover | PASS | **FIXED→PASS** | same | 0 fetches → **+1 CampaignList** before click; log `/campaigns@…` | Document-level `pointerover` 200ms dwell |
| Font preload once | PASS | **PASS** | same | late Mono fetch@23s → **all 6 woff2 @~20ms** | Preload tags in `index.html` |
| backdrop-filter only ⌘K+dock | PASS | **FIXED→PASS** | same + CSSOM scan | command-bar+overlay+toast+auth glass → **only `.cmdk` + `.call-dock`** | 4 CSSOM hits = duplicate rules for those two |
| Waveform off React state | implied ambient | **FIXED→PASS** | code + live FPS | setState@90ms → **canvas rAF**; FPS **61** avg | Worst frame **19ms** (target ≤16.6 — close; FIXED not perfect) |
| Timer not re-rendering tree | not claimed | **FIXED→PASS** | `CallSessionTimer.tsx` | CampaignDetail@1Hz → timer-only | Parent no longer ticks |
| Campaign list virtualized | not claimed | **FIXED→PASS** | `VirtualizedRows.tsx` | all rows → **~20 viewport** | DOM count 2 in demo (tiny set) |
| Sidebar nav shell <100ms | implied | **PASS** | same | ~1000ms cold → **shell 7ms** / full 323ms | Full still includes data fetch |
| Live-call 60fps 30s | claimed | **PARTIAL** | same | n/a → **2s sample 61fps**, worst 19ms | 30s Chrome Performance `.json` export **NOT DONE** (CDP sample only) |
| INP Sign In <200ms | claimed | **NOT DONE** | — | — | Redirected session; need cold login Event Timing |
| INP Log Outcome / Hang Up | claimed | **NOT DONE** | — | — | Not instrumented this pass |
| ⌘K open/select INP | claimed | **NOT DONE** | — | — | Not instrumented this pass |
| Chrome Performance `.json` traces ×7 | required | **NOT DONE** | summary JSON only | — | Need DevTools export; summary metrics captured via Performance API |
| Filmstrips (4-frame) | required | **NOT DONE** | `filmstrips/` empty | — | No mid-animation capture automation this pass |
| Before screenshots from git | required | **NOT DONE** | — | — | No pre-pass checkout screenshots archived |
| Logo ruler overlays | required | **NOT DONE** | — | — | Spec sizes in CSS; no ruler PNGs |
| Whoa stranger test (3 people) | required | **NOT DONE** | `whoa-test.md` | — | Requires humans; agent cannot substitute |
| Whoosh stranger test (3 people) | required | **NOT DONE** | `whoosh-test.md` | — | Agent timed flows only — not a stranger PASS |
| Reduced-motion screenshots | claimed | **NOT DONE** | — | CSS fallbacks exist | OS toggle not screenshot this pass |

## Red flags vs prior checklist

Prior report marked press / optimistic / prefetch as done. **Prefetch and press were incomplete or unreliable until this audit** (React hover never fired prefetch; press relied on `:active` alone). Optimistic Start Dialing *was* in code but **timer/waveform made the live screen feel slow anyway** — the checklist claimed speed without measuring the real bottlenecks.
