import { useState, type FormEvent, type ReactElement } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { useNotifier } from "../notifications/context.js";

export function RegisterPage(): ReactElement {
  const nav = useNavigate();
  const { pushToast } = useNotifier();
  const { user, registerCompany } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "");
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    const companyName = String(fd.get("companyName") ?? "");
    try {
      await registerCompany({ name, email, password, companyName });
      pushToast({ variant: "success", title: "Company created", message: "You are signed in as owner." });
      nav("/dashboard");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErr(msg);
      pushToast({ variant: "error", title: "Registration failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-center">
      <form className="panel panel-lift form-card auth-card" onSubmit={onSubmit}>
        <h2 className="auth-card__title">Create your company</h2>
        <p className="auth-card__lede">
          Register a company workspace. You become the organization owner and can invite employees.
        </p>
        <label>Your name</label>
        <input name="name" required placeholder="Full name" />
        <label style={{ marginTop: 12 }}>Work email</label>
        <input name="email" type="email" required placeholder="you@company.com" />
        <label style={{ marginTop: 12 }}>Password</label>
        <input name="password" type="password" minLength={8} required placeholder="At least 8 characters" />
        <label style={{ marginTop: 12 }}>Company name</label>
        <input name="companyName" required placeholder="Acme Outreach LLC" />
        {err ? <p className="error">{err}</p> : null}
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center" }}>
          <button className="primary glow-hover" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create company"}
          </button>
          <Link className="text-link" to="/login">
            Already have an account?
          </Link>
        </div>
      </form>
    </div>
  );
}
