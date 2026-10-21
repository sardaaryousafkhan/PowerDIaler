# Honesty pass — evidence pack README

Answers below are self-contained. Each points at a file in this zip.

1. How many dead controls existed before this pass? How many are now WIRE / REMOVE / HONEST-LABEL?  
   **23 total → 12 wired / 6 removed / 5 honest-labeled.** Evidence: `honesty-table.md`.

2. Are all five live-call dock buttons now functional or honestly labeled?  
   - Mute = WIRE (works) — `screens/honest-labels/dock-visible-states.png`  
   - Hold = HONEST-LABEL (visible text: "Needs carrier hold") — `screens/honest-labels/dock-visible-states.png` + `screens/honest-labels/dock-visible-states.md`  
   - Transfer = HONEST-LABEL (visible text: "Not available yet") — same  
   - Keypad = HONEST-LABEL (visible text: "DTMF not available yet") — same  
   - Hang up = WIRE (works) — same screenshot

3. Is there any "coming soon" button left in the app?  
   **NO — zero.** Grep of `apps/web/src` for "coming soon" is empty (re-check locally; pack note in `dead-files-removed.txt`).

4. Do Start and Open now do different things, or is there only one button?  
   **Merged preview actions:** list row opens preview; preview has **Open campaign** (detail) and **Start dialing** (starts queue → live call). Start dialing lives in the campaign preview panel. Evidence: `screens/wired/preview-start-dialing.png` + `golden-flows/flow-2.gif`.

5. How many dead CSS files were removed?  
   **3.** Proof: `dead-files-removed.txt` (`rm` of `styles.css`, `theme-vibrant.css`, `site.css` + `ls` missing).

6. How many theme toggles remain?  
   **1.** Proof: `screens/removed/theme-toggle-grep.txt` — single `<ThemeToggle />` at `apps/web/src/DialerApp.tsx:436`.

7. Which 3+ pages got shell-level structural differentiation?  
   - **Dashboard** — hero bleed / pace above title — `shell-differentiation/dashboard-1440x900.png`  
   - **Campaigns** — master-detail list + preview — `shell-differentiation/campaigns-master-detail-1440x900.png`  
   - **Live call** — full-width immersive dock, rail icon-only — `shell-differentiation/live-call-immersive-1440x900.png`  
   - **Org settings** — single-scroll editorial column, serif section headers — `shell-differentiation/org-settings-editorial-1440x900.png`

8. Do all 4 golden flows pass without regression?  
   - Flow 1 (sign in → dashboard) — **PASS** — `golden-flows/flow-1.gif` (~2 frames / ~1.6s loop)  
   - Flow 2 (open campaign → Start dialing → live call) — **PASS** — `golden-flows/flow-2.gif`  
   - Flow 3 (disposition → hang up → campaign) — **PASS** — `golden-flows/flow-3.gif`  
   - Flow 4 (CSV import dedupe → View skipped) — **PASS** — `golden-flows/flow-4.gif` + `golden-flows/flow-4-import-dedupe.png`

## Extra gap proofs

- Portal password E2E: `screens/wired/portal-password-change/` (`01-password-updated.png`, `02-old-password-rejected.png`, `03-new-password-signin.png`, `password-change-e2e.gif`, `signin-old-fail-new-ok.gif`). Name + prefs persist: `screens/wired/portal-name-prefs-persisted.png`.
- Note: changing password does not force-sign-out other tabs; old password login still fails (proven).
