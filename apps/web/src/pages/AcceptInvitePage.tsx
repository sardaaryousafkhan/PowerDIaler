import { useMemo, useState, type FormEvent, type ReactElement } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { useNotifier } from "../notifications/context.js";

export function AcceptInvitePage(): ReactElement {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const { user, acceptInvite } = useAuth();
  const nav = useNavigate();
  const { pushToast } = useNotifier();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (user && !token) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setErr("Missing invite token.");
      return;
    }
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      await acceptInvite({
        token,
        name: String(fd.get("name") ?? "") || undefined,
        password: String(fd.get("password") ?? "") || undefined,
      });
      pushToast({ variant: "success", title: "Welcome", message: "You joined the organization." });
      nav("/dashboard");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErr(msg);
      pushToast({ variant: "error", title: "Invite failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-center">
      <form className="panel panel-lift form-card auth-card" onSubmit={onSubmit}>
        <h2 className="auth-card__title">Accept invite</h2>
        <p className="auth-card__lede">Join your company workspace. New users need a name and password.</p>
        {!token ? <p className="error">This invite link is missing a token.</p> : null}
        <label>Name (new accounts)</label>
        <input name="name" placeholder="Full name" />
        <label style={{ marginTop: 12 }}>Password (new accounts)</label>
        <input name="password" type="password" minLength={8} placeholder="At least 8 characters" />
        {err ? <p className="error">{err}</p> : null}
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center" }}>
          <button className="primary" type="submit" disabled={busy || !token}>
            {busy ? "Joining…" : "Accept invite"}
          </button>
          <Link className="text-link" to="/login">
            Sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
