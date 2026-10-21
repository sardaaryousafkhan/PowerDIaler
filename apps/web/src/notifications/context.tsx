import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api.js";
import { IconBell, IconX } from "../icons/index.js";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastItem = {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  createdAt: number;
};

export type ActivityState = {
  headline: string;
  detail?: string;
  tone: "neutral" | "ok" | "warn" | "busy";
};

type SetActivityArg = Partial<ActivityState> | ((prev: ActivityState) => ActivityState);

const HISTORY_MAX = 50;

type Ctx = {
  pushToast: (t: {
    variant: ToastVariant;
    title: string;
    message?: string;
    durationMs?: number;
  }) => void;
  dismissToast: (id: string) => void;
  setActivity: (arg: SetActivityArg) => void;
  activity: ActivityState;
  toasts: ToastItem[];
  history: ToastItem[];
  clearHistory: () => void;
};

const defaultActivity: ActivityState = {
  headline: "Connecting…",
  detail: "Checking API",
  tone: "neutral",
};

const NotifierCtx = createContext<Ctx | null>(null);

export function useNotifier(): Ctx {
  const v = useContext(NotifierCtx);
  if (!v) throw new Error("useNotifier must be used inside ToastProvider");
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<ToastItem[]>([]);
  const [activity, setActivityState] = useState<ActivityState>(defaultActivity);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const pushToast = useCallback(
    (opts: {
      variant: ToastVariant;
      title: string;
      message?: string;
      durationMs?: number;
    }) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: ToastItem = {
        id,
        variant: opts.variant,
        title: opts.title,
        message: opts.message,
        createdAt: Date.now(),
      };
      setToasts((list) => [item, ...list].slice(0, 8));
      setHistory((list) => [item, ...list].slice(0, HISTORY_MAX));
      const ms =
        opts.durationMs ??
        (opts.variant === "error" ? 9000 : opts.variant === "warning" ? 7000 : 5200);
      const handle = setTimeout(() => dismissToast(id), ms);
      timers.current.set(id, handle);
    },
    [dismissToast],
  );

  const setActivity = useCallback((arg: SetActivityArg) => {
    setActivityState((prev) => (typeof arg === "function" ? arg(prev) : { ...prev, ...arg }));
  }, []);

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      pushToast,
      dismissToast,
      setActivity,
      activity,
      toasts,
      history,
      clearHistory,
    }),
    [pushToast, dismissToast, setActivity, activity, toasts, history, clearHistory],
  );

  return (
    <NotifierCtx.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <ActivityStrip state={activity} />
      <HealthBridge />
    </NotifierCtx.Provider>
  );
}

function formatToastTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Bell control for the command bar — lists last 50 toasts (history survives dismiss). */
export function ToastHistoryButton(): ReactElement {
  const { history, clearHistory } = useNotifier();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="toast-history">
      <button
        type="button"
        className="command-bar__icon-btn"
        aria-label="Notification history"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell size={16} />
        {history.length > 0 ? (
          <span className="toast-history__badge" aria-hidden>
            {history.length > 9 ? "9+" : history.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="toast-history-drawer" role="dialog" aria-label="Notification history">
          <div className="toast-history-drawer__head">
            <h3 className="toast-history-drawer__title">Notifications</h3>
            <button
              type="button"
              className="ghost-btn btn-32"
              disabled={history.length === 0}
              onClick={() => clearHistory()}
            >
              Clear all
            </button>
          </div>
          {history.length === 0 ? (
            <p className="toast-history-drawer__empty muted subtle">No notifications yet this session.</p>
          ) : (
            <ul className="toast-history-drawer__list">
              {history.map((t) => (
                <li key={t.id} className={`toast-history-drawer__item toast-history-drawer__item--${t.variant}`}>
                  <div className="toast-history-drawer__meta">
                    <span className="toast-history-drawer__variant">{t.variant}</span>
                    <time dateTime={new Date(t.createdAt).toISOString()}>{formatToastTime(t.createdAt)}</time>
                  </div>
                  <div className="toast-history-drawer__item-title">{t.title}</div>
                  {t.message ? <div className="toast-history-drawer__item-msg">{t.message}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function routeHint(path: string): string | undefined {
  if (path === "/") return "Campaign index and workspace entry.";
  if (path === "/new") return "Select dialing or SMS-only campaign setup.";
  if (path === "/new/dial") return "Configure a voice dialing campaign.";
  if (path === "/new/sms") return "Configure an SMS-only campaign.";
  if (path.startsWith("/campaigns/")) return "Campaign workspace";
  if (path === "/dnc") return "Global do-not-contact suppression.";
  if (path === "/integrations") return "Integration roadmap and preference.";
  return undefined;
}

function HealthBridge(): null {
  const { setActivity } = useNotifier();
  const loc = useLocation();

  useEffect(() => {
    setActivity((prev) => {
      // Campaign detail & integrations set richer lines; do not replace with the generic route hint.
      if (loc.pathname.startsWith("/campaigns/") || loc.pathname === "/integrations") return prev;
      return { ...prev, detail: routeHint(loc.pathname) };
    });
  }, [loc.pathname, setActivity]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        await api.health();
        if (!alive) return;
        setActivity((prev) => ({
          ...prev,
          headline: "API online",
          tone: "ok",
        }));
      } catch {
        if (!alive) return;
        setActivity((prev) => ({
          ...prev,
          headline: "API unreachable",
          tone: "warn",
        }));
      }
    };
    void tick();
    const i = window.setInterval(() => void tick(), 12000);
    return () => {
      alive = false;
      window.clearInterval(i);
    };
  }, [setActivity]);

  return null;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}): ReactElement {
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions text">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.variant === "success" ? "success" : t.variant === "warning" ? "warning" : t.variant === "error" ? "error" : "info"}`} role="status">
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
          >
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ActivityStrip({ state }: { state: ActivityState }): ReactElement {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 4200);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [state.headline, state.detail, state.tone]);

  return (
    <div className={`activity-strip activity-${state.tone} ${visible ? "" : "activity-strip--hidden"}`}>
      <span className="activity-pulse" aria-hidden />
      <div className="activity-text">
        <div className="activity-headline">{state.headline}</div>
        {state.detail ? <div className="activity-detail">{state.detail}</div> : null}
      </div>
    </div>
  );
}
