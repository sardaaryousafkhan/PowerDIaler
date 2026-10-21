/**
 * Live-call right panel (Call Control / Contact / Wrap-Up / Session / Insights).
 *
 * QA matrix:
 * - Flag OFF: legacy layout — disposition chips on stage, no right panel.
 * - Flag ON: chips only in Wrap-Up; never both.
 *
 * Enable: localStorage `pd_live_call_right_panel=1` or `?livePanel=1`
 * Disable: localStorage `0` / remove, or `?livePanel=0`
 * Env: VITE_LIVE_CALL_RIGHT_PANEL=1
 */
const LS_KEY = "pd_live_call_right_panel";

export function isLiveCallRightPanelEnabled(): boolean {
  if (typeof window === "undefined") {
    return import.meta.env.VITE_LIVE_CALL_RIGHT_PANEL === "1";
  }
  const q = new URLSearchParams(window.location.search).get("livePanel");
  if (q === "1" || q === "true") return true;
  if (q === "0" || q === "false") return false;
  const ls = localStorage.getItem(LS_KEY);
  if (ls === "1" || ls === "true") return true;
  if (ls === "0" || ls === "false") return false;
  return import.meta.env.VITE_LIVE_CALL_RIGHT_PANEL === "1";
}

export function setLiveCallRightPanelEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, on ? "1" : "0");
}
