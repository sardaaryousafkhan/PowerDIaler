import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { AppLogo } from "../components/AppLogo.js";
import { useNotifier } from "../notifications/context.js";

export function LoginPage(): ReactElement {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { pushToast } = useNotifier();
  const { user, login, applySession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Prefetch dashboard chunk so Sign In INP isn't waiting on JS download
    void import("./DashboardPage.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const googleToken = params.get("google_token");
    if (!googleToken) return;
    setBusy(true);
    void applySession(googleToken)
      .then(() => {
        pushToast({ variant: "success", title: "Signed in", message: "Welcome via Google." });
        nav("/dashboard");
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        setErr(msg);
      })
      .finally(() => setBusy(false));
  }, [params, applySession, nav, pushToast]);

  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    // Navigate immediately once signingIn flips — dashboard shell paints while auth completes
    const loginPromise = login(email, password);
    nav("/dashboard");
    try {
      await loginPromise;
      pushToast({ variant: "success", title: "Signed in", message: "Welcome back." });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErr(msg);
      pushToast({ variant: "error", title: "Login failed", message: msg });
      nav("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      <aside className="auth-split__editorial" aria-hidden={false}>
        <p className="editorial--hero">The line is yours.</p>
        <hr className="auth-split__rule" />
        <p className="muted" style={{ marginTop: 20, maxWidth: "28ch", fontSize: 15, lineHeight: "22px" }}>
          Pace, connect, and close — built for operators who live on the phone.
        </p>
      </aside>
      <div className="auth-split__panel">
        <AppLogo size="xl" drawIn markOnly />
        <form className="auth-card auth-card--glass" onSubmit={onSubmit}>
          <h1 className="h2" style={{ marginBottom: 8 }}>
            Sign in
          </h1>
          <p className="auth-lede">Use your work email, or Google when configured.</p>
          <label>Email</label>
          <input name="email" type="email" required placeholder="you@company.com" autoComplete="username" />
          <label style={{ marginTop: 12 }}>Password</label>
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            autoComplete="current-password"
          />
          {err ? (
            <p className="error-banner" style={{ marginTop: 12 }}>
              {err}
            </p>
          ) : null}
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            <button className="primary pressable" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <a className="text-link" href="/api/auth/google">
                Continue with Google
              </a>
              <Link className="text-link" to="/register">
                Create company
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
