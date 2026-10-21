# Live-call right panel

Feature flag: `isLiveCallRightPanelEnabled()` in `apps/web/src/featureFlags.ts`

| State | How | Layout |
|-------|-----|--------|
| **OFF** | default, or `?livePanel=0`, or `localStorage pd_live_call_right_panel=0` | Chips on stage; script aside; bottom dock; no right panel |
| **ON** | `?livePanel=1` or `localStorage pd_live_call_right_panel=1` or `VITE_LIVE_CALL_RIGHT_PANEL=1` | Chips **only** in Wrap-Up; script in Contact; dock in Call Control; never both chip mounts |

## Acceptance conditions (ticket)

1. Collapsed panel must not hide Wrap-Up — on `callEnded`, auto-expand + select Wrap-Up (and badge when collapsed).
2. Flag off / flag on are two QA states; chips never in both places.
3. Working single Transfer stays outside Coming soon; Warm/Blind/directory inside.
4. Coming soon summary is expandable/focusable; children inert.
5. End Call hint only if hang-up lands on session controls (verified: hang-up → `pause()` → campaign Pause/Resume chrome).
6. Renames: label / tooltip / aria / user-facing copy only.

## Backlog (open as tickets, not comments)

- Mandatory disposition dropdown (chips stay this pass)
- Hotkeys post-rename shortcut mapping
- Pacing verification (owner + deadline; default: keep original SMS rate label)
- Flag kill-switch criteria + owner before rollout
