# Honesty table — functional integrity + cruft removal

| Item | Action | Evidence | Notes |
|------|--------|----------|-------|
| styles.css / theme-vibrant.css / site.css | REMOVE | screens/removed/dead-css.txt, dead-files-removed.txt | Deleted from disk; zero src refs |
| Extra theme toggles (sidebar + settings) | REMOVE | screens/removed/theme-toggle-grep.txt | One ThemeToggle remains in command bar |
| Font / density / radius / chrome / accent / compliance settings | REMOVE | screens/removed/settings-fields-grep.txt | Fields removed from model + API + UI |
| notifyDesktop / notifySound | REMOVE | screens/removed/settings-fields-grep.txt | Gone from model + API |
| #2563eb accent default | REMOVE | dead-files-removed.txt | Zero matches in apps/web/src + apps/api/src |
| Live-call Mute | WIRE (already) | screens/honest-labels/dock-visible-states.png | Unchanged functional control |
| Live-call Hold | HONEST-LABEL | screens/honest-labels/dock-visible-states.png | Visible reason: Needs carrier hold |
| Live-call Transfer | HONEST-LABEL | screens/honest-labels/dock-visible-states.png | Visible reason: Not available yet |
| Live-call Keypad | HONEST-LABEL | screens/honest-labels/dock-visible-states.png | Visible reason: DTMF not available yet |
| Live-call Hang up | WIRE (already) | screens/honest-labels/dock-visible-states.png | Remains functional |
| User portal | WIRE | screens/wired/portal-password-change/ | Name edit, password change, prefs |
| Billing Stripe fake button | HONEST-LABEL | screens/honest-labels/billing-manual.png | Manual billing copy; no button |
| Cmd+K Members/Billing/Portal/campaigns | WIRE | CommandPalette.tsx | Fuzzy campaign + member search |
| Help link | WIRE | /help/index.html + command-bar ? | Real local help page |
| Start vs Open duplicate | REMOVE | screens/wired/preview-start-dialing.png | Preview: Open campaign + Start dialing |
| Duplicate SMS “FAILED” label | HONEST-LABEL | formatSmsStatus + dashboard SKIPPED | UI: Skipped — already texted (15 days) |
| Import same phone 3× | WIRE | golden-flows/flow-4-import-dedupe.png | 2 imported, 2 duplicates skipped + View skipped |
| Dashboard date range + export | WIRE | screens/wired/dashboard-date-range-export.png | Today/7/30/Custom + Export CSV |
| Toast history bell | WIRE | command-bar Notification history | Last 50 + Clear all |
| Shell: Dashboard hero bleed | WIRE | shell-differentiation/dashboard-1440x900.png | Pace above title |
| Shell: Campaigns master-detail | WIRE | shell-differentiation/campaigns-master-detail-1440x900.png | 400px list + preview |
| Shell: Live call immersive | WIRE | shell-differentiation/live-call-immersive-1440x900.png | Full-width dock, rail icon-only |
| Shell: Org settings editorial | WIRE | shell-differentiation/org-settings-editorial-1440x900.png | Serif section headers |
| README.md | ADDED | docs/evidence-pack/README.md | 8/8 answered |
| Golden flow 1 (sign in) | PASS | golden-flows/flow-1.gif | ~20s loop of login→dashboard frames |
| Golden flow 2 (dial) | PASS | golden-flows/flow-2.gif | Preview Start dialing → live call |
| Golden flow 3 (outcome + hang up) | PASS | golden-flows/flow-3.gif | Disposition → hang up → campaign |
| Golden flow 4 (import dedupe) | PASS | golden-flows/flow-4.gif | 2 created, 2 skipped + View skipped |
| Shell: Live-call immersive | PASS | shell-differentiation/live-call-immersive-1440x900.png | replaced file ref |
| Shell: Org settings editorial | PASS | shell-differentiation/org-settings-editorial-1440x900.png | replaced file ref |
| Dock disabled states | HONEST-LABEL | screens/honest-labels/dock-visible-states.png | visible text confirmed |
| Portal password change | WIRE | screens/wired/portal-password-change/ | end-to-end proven |
| Start/Open merge | WIRE | screens/wired/preview-start-dialing.png | trigger confirmed in preview |
