# Art-direction + performance pass — evidence-backed

## How to measure (non-negotiable)

```bash
pnpm --filter @powerdialer/web run build
pnpm --filter @powerdialer/web exec vite preview --host 127.0.0.1 --port 4173
# open http://127.0.0.1:4173  — NOT :5173
```

API must be up on `:4000` (preview proxy `/api` → `4000`).

---

## Performance — cause, fix, and before/after

| Cause | Fix | Before → After |
|---|---|---|
| Demo on Vite **dev** | Measure **preview** only | Subjective lag → FCP ~**211ms** on prod |
| Waveform `setState` @90ms | **Canvas** rAF, no React state | Re-render storm → **60fps** / 30s |
| `sessionSeconds` in CampaignDetail | **`CallSessionTimer`** isolated | Full page @1Hz → timer-only (detailΔ≈2 / 5s) |
| `backdrop-filter` on command bar + overlay + toast + auth | Removed; glass **only** `.cmdk` + `.call-dock` | Full-width blur → CSSOM dock/cmdk only |
| Eager Dashboard/List in main chunk | `lazy()` + hover prefetch | Main ~**148KB** gzip; CampaignList prefetch on hover |
| Framer route opacity/y every nav | Plain `.route-shell` | Shell nav **40–43ms** |
| Unvirtualized campaign rows | `VirtualizedRows` (~26–32) | 520 items, windowed DOM |
| Sign-in blocked on scrypt + late nav | Demo v2 scrypt + optimistic `signingIn` shell | ~421ms → **24ms** shell |
| Open campaign cold chunk | Prefetch `CampaignDetail` on list mount/hover | 1176ms → **10ms** |

Traces: `docs/evidence/traces/*.json`.

### INP / interaction targets (production :4173)

| Interaction | Target | Measured | Status |
|---|---|---|---|
| Sign in → dashboard shell | <200ms | **24ms** | PASS |
| Open campaign | <200ms | **10ms** | PASS |
| Start Dialing → live shell | <100ms | **32ms** | PASS |
| Log outcome | <100ms | **28ms** | PASS |
| Hang up | <100ms | **10ms** | PASS |
| ⌘K open | <100ms | **26ms** | PASS |
| ⌘K select | <200ms | **24ms** | PASS |
| Cached sidebar nav | <100ms | **40ms** | PASS |
| Uncached sidebar nav | <300ms | **43ms** | PASS |
| Mute | <50ms | **34ms** | PASS |
| Live-call 30s FPS | 60 / note spikes | **60** avg; worst **50.1ms** (1 spike) | PASS w/ note |

---

## Visual art-direction (spec → shipped → evidence)

### Login
- **Spec:** Split editorial 56px serif, 96px draw-in mark, rose border card, 56px CTA  
- **Shipped:** `LoginPage` + `.auth-split` / `AppLogo size=xl drawIn`  
- **Evidence:** `filmstrips/login-draw.gif`, `screenshots/login-1440.png`  
- **Deviation:** Auth card no backdrop-filter (perf)

### Dashboard
- **Spec:** 72px connects, 160px pace ring, KPI hairline row, watermark 320@4%  
- **Shipped:** `PaceRing`, `CountUp`, `.dash-kpi-row`, `.app-logo-watermark`  
- **Evidence:** `filmstrips/pace-ring-draw.gif`, `filmstrips/page-enter.gif`

### Campaigns
- **Spec:** 56px rows, rose left border RUNNING, hover Start  
- **Shipped:** `.campaign-row` + virtualization  
- **Evidence:** `dom/campaign-list-dom-count.png` (520 / ~32 DOM)

### Live call
- **Spec:** 96px timer, 40-bar jade waveform, glass dock, rose bloom  
- **Shipped:** `CallSessionTimer`, canvas `LiveWaveform`, `.live-call--connected`  
- **Evidence:** `screenshots/live-call-1440.png`, `filmstrips/connect-bloom.gif`, `filmstrips/waveform-idle.gif`

### ⌘K
- **Spec:** 560px glass, 48px mark watermark  
- **Shipped:** `CommandPalette` + `.cmdk` glass (allowed)  
- **Evidence:** `dom/backdrop-filter-audit.png`

### Logo suite
- **Spec:** 16–512 sizes  
- **Shipped:** `AppLogo` size map + pack screenshots  
- **Evidence:** `screenshots/logo-placements/logo-{16…512}.png`

---

## Whoa / Whoosh

See `docs/evidence/tests/whoa-test.md` and `whoosh-test.md`.  
**Stranger PASS not claimed.** Scheduled **2026-10-20** on local `:4173`.

---

## Archive layout

```
docs/evidence/          (source of truth; also zipped as docs/evidence-pack.zip)
  README.md
  honesty-table.md
  art-direction-pass.md
  traces/
  filmstrips/*.gif
  screenshots/
  network/
  dom/
  profiler/
  tests/
```
