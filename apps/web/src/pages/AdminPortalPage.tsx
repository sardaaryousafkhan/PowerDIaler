import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { FUNCTION_PERMISSION_KEYS, type FunctionPermissionKey } from "@powerdialer/shared";
import type { AdminAccessUserRow } from "../api.js";
import { api } from "../api.js";
import { useAuth } from "../authContext.js";
import { useNotifier } from "../notifications/context.js";

const FUNCTION_LABELS: Record<FunctionPermissionKey, { title: string; detail: string }> = {
  campaign_view: { title: "View campaigns", detail: "Open assigned campaigns." },
  campaign_dial: { title: "Dial & log outcomes", detail: "Place calls and record results." },
  campaign_notes: { title: "Contact notes", detail: "Edit notes on assigned contacts." },
  campaign_start: { title: "Start campaigns", detail: "Start assigned campaigns." },
  campaign_pause: { title: "Pause campaigns", detail: "Pause running campaigns." },
  campaign_resume: { title: "Resume campaigns", detail: "Resume paused campaigns." },
  sms_broadcast: { title: "Send SMS", detail: "Queue SMS to assigned campaigns." },
  campaign_create: { title: "Create campaigns", detail: "Create new campaigns." },
  campaign_delete: { title: "Delete campaigns", detail: "Remove campaigns." },
  contact_import: { title: "Import contacts", detail: "Upload contact lists." },
  dnc_manage: { title: "Manage DNC", detail: "Edit the Do-Not-Call list." },
  crm_manage: { title: "Manage CRM", detail: "CRM sync and activity." },
  integrations_manage: { title: "Manage integrations", detail: "Provider settings & credentials." },
  members_manage: { title: "Manage members", detail: "Add people and change roles." },
  company_settings: { title: "Company settings", detail: "Company name and defaults." },
  billing_view: { title: "View billing", detail: "Plan and seat usage." },
};

const ROLE_LABELS: Record<string, string> = {
  ORG_OWNER: "Owner",
  ORG_ADMIN: "Admin",
  AGENT: "Agent",
};

function roleOf(row: AdminAccessUserRow): string {
  return row.orgRole ?? (row.role === "user" ? "AGENT" : "ORG_ADMIN");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function AdminPortalPage(): ReactElement {
  const { user, can } = useAuth();
  const { pushToast } = useNotifier();
  const canManage = can("members_manage") || user?.role === "admin" || user?.role === "owner";

  const [rows, setRows] = useState<AdminAccessUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AdminAccessUserRow["permissions"]>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Add employee form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("AGENT");
  const [addPassword, setAddPassword] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string | null } | null>(null);

  // Invite link
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  async function reload(): Promise<void> {
    setLoading(true);
    try {
      const r = await api.adminAccess.listUsers();
      setRows(r.users);
      setDrafts(Object.fromEntries(r.users.map((u) => [u.id, u.permissions])));
      setRoleDrafts(Object.fromEntries(r.users.map((u) => [u.id, roleOf(u)])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canManage) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const seatsUsed = rows.length;

  if (!user) return <Navigate to="/login" replace />;
  if (!canManage) return <Navigate to="/portal/user" replace />;

  function updateDraft(userId: string, key: FunctionPermissionKey, allowed: boolean): void {
    setDrafts((curr) => ({
      ...curr,
      [userId]: { ...(curr[userId] ?? rows.find((r) => r.id === userId)?.permissions), [key]: allowed },
    }));
  }

  async function saveSelected(): Promise<void> {
    if (!selected) return;
    const draft = drafts[selected.id] ?? selected.permissions;
    const nextRole = roleDrafts[selected.id];
    const changes = Object.fromEntries(
      FUNCTION_PERMISSION_KEYS.filter((k) => draft[k] !== selected.permissions[k]).map((k) => [k, draft[k]]),
    ) as Partial<AdminAccessUserRow["permissions"]>;
    const roleChanged = nextRole && nextRole !== roleOf(selected);
    if (!Object.keys(changes).length && !roleChanged) return;
    setSaving(true);
    try {
      const out = await api.adminAccess.patchUser(selected.id, changes, roleChanged ? nextRole : undefined);
      setRows((curr) =>
        curr.map((r) => (r.id === selected.id ? { ...r, permissions: out.permissions, orgRole: out.orgRole } : r)),
      );
      setDrafts((curr) => ({ ...curr, [selected.id]: out.permissions }));
      setRoleDrafts((curr) => ({ ...curr, [selected.id]: out.orgRole }));
      pushToast({ variant: "success", title: "Saved", message: `${selected.name}'s access updated.` });
    } catch (e) {
      pushToast({ variant: "error", title: "Save failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function onAddEmployee(e: FormEvent): Promise<void> {
    e.preventDefault();
    setAddBusy(true);
    setCreated(null);
    try {
      const r = await api.org.createMember({
        name: addName,
        email: addEmail,
        orgRole: addRole,
        password: addPassword.trim() ? addPassword : undefined,
      });
      setCreated({ email: r.email, temporaryPassword: r.temporaryPassword });
      setAddName("");
      setAddEmail("");
      setAddPassword("");
      pushToast({ variant: "success", title: "Account created", message: `${r.name} can sign in now.` });
      await reload();
      setSelectedId(r.id);
    } catch (err) {
      pushToast({ variant: "error", title: "Could not add", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setAddBusy(false);
    }
  }

  async function onInvite(e: FormEvent): Promise<void> {
    e.preventDefault();
    setInviteBusy(true);
    try {
      const r = await api.org.createInvite({ email: inviteEmail, orgRole: "AGENT" });
      setInviteLink(`${window.location.origin}${r.acceptPath}`);
      setInviteEmail("");
    } catch (err) {
      pushToast({ variant: "error", title: "Invite failed", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setInviteBusy(false);
    }
  }

  async function onRemove(row: AdminAccessUserRow): Promise<void> {
    if (!window.confirm(`Remove ${row.name} from your company? They will lose access immediately.`)) return;
    try {
      await api.org.removeMember(row.id);
      pushToast({ variant: "success", title: "Removed", message: `${row.name} no longer has access.` });
      if (selectedId === row.id) setSelectedId(null);
      await reload();
    } catch (err) {
      pushToast({ variant: "error", title: "Remove failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ variant: "success", title: "Copied", message: "Copied to clipboard." });
    } catch {
      pushToast({ variant: "warning", title: "Copy manually", message: text });
    }
  }

  const draft = selected ? drafts[selected.id] ?? selected.permissions : null;
  const selectedRole = selected ? roleDrafts[selected.id] ?? roleOf(selected) : "AGENT";
  const hasChanges =
    Boolean(selected && draft && FUNCTION_PERMISSION_KEYS.some((k) => draft[k] !== selected.permissions[k])) ||
    Boolean(selected && selectedRole !== roleOf(selected));
  const isAgentRole = selectedRole === "AGENT";

  return (
    <div className="detail-stack">
      <header className="page-hero page-hero--compact">
        <p className="page-hero__eyebrow">Team</p>
        <h2 className="page-hero__title">Members</h2>
        <p className="page-hero__lede">
          Add employees under your company, pick their role, and fine-tune what agents can do.
        </p>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="primary glow-hover" type="button" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Close" : "+ Add employee"}
          </button>
          <span className="pill pill-soft">{seatsUsed} active {seatsUsed === 1 ? "seat" : "seats"}</span>
        </div>
      </header>

      {showAdd ? (
        <section className="panel panel-lift">
          <h3 className="section-title">Add employee</h3>
          <p className="section-lede">
            Creates a sign-in for this person right away. Leave the password blank to get a temporary one you can share.
          </p>
          <form className="form-grid" onSubmit={(e) => void onAddEmployee(e)}>
            <label className="field">
              <span className="field-label">Full name</span>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} required placeholder="Jordan Lee" />
            </label>
            <label className="field">
              <span className="field-label">Work email</span>
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
                placeholder="jordan@company.com"
              />
            </label>
            <label className="field">
              <span className="field-label">Role</span>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                <option value="AGENT">Agent — sees assigned campaigns only</option>
                <option value="ORG_ADMIN">Admin — manages campaigns and team</option>
                <option value="ORG_OWNER">Owner — full control</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Password (optional)</span>
              <input
                type="text"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                placeholder="Leave blank to auto-generate"
                minLength={8}
              />
            </label>
            <div className="btn-row form-grid__full">
              <button className="primary" type="submit" disabled={addBusy}>
                {addBusy ? "Creating…" : "Create account"}
              </button>
            </div>
          </form>
          {created ? (
            <div className="callout callout-success" style={{ marginTop: 14 }}>
              <strong>Share these sign-in details with {created.email}</strong>
              {created.temporaryPassword ? (
                <div className="btn-row" style={{ marginTop: 8, alignItems: "center" }}>
                  <code className="mono">{created.temporaryPassword}</code>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void copy(`Email: ${created.email}\nPassword: ${created.temporaryPassword}`)}
                  >
                    Copy
                  </button>
                </div>
              ) : (
                <p className="muted subtle" style={{ marginTop: 6 }}>This person already had an account — they can sign in with their existing password.</p>
              )}
            </div>
          ) : null}

          <details style={{ marginTop: 18 }}>
            <summary className="text-link" style={{ cursor: "pointer" }}>Prefer to send an invite link instead?</summary>
            <form className="btn-row" style={{ marginTop: 10, alignItems: "flex-end" }} onSubmit={(e) => void onInvite(e)}>
              <label className="field" style={{ margin: 0, minWidth: 260 }}>
                <span className="field-label">Email</span>
                <input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="agent@company.com" />
              </label>
              <button className="ghost-btn" type="submit" disabled={inviteBusy}>Create link</button>
            </form>
            {inviteLink ? (
              <div className="btn-row" style={{ marginTop: 10, alignItems: "center" }}>
                <code className="mono" style={{ wordBreak: "break-all" }}>{inviteLink}</code>
                <button type="button" className="ghost-btn" onClick={() => void copy(inviteLink)}>Copy</button>
              </div>
            ) : null}
          </details>
        </section>
      ) : null}

      <div className="members-layout">
        <section className="panel panel-lift">
          <h3 className="section-title">People</h3>
          {error ? <p className="error">{error}</p> : null}
          {loading ? <p className="muted subtle">Loading…</p> : null}
          {!loading && rows.length === 0 ? <p className="muted subtle">No members yet.</p> : null}
          <ul className="member-list">
            {rows.map((r) => {
              const role = roleOf(r);
              const isSelf = r.id === user.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`member-row${selectedId === r.id ? " member-row--active" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className={`avatar avatar--${role.toLowerCase()}`}>{initials(r.name)}</span>
                    <span className="member-row__copy">
                      <span className="member-row__name">
                        {r.name}
                        {isSelf ? <span className="muted subtle"> (you)</span> : null}
                      </span>
                      <span className="member-row__email">{r.email}</span>
                    </span>
                    <span className={`pill pill-role pill-role--${role.toLowerCase()}`}>{ROLE_LABELS[role] ?? role}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel panel-lift">
          {!selected || !draft ? (
            <div className="empty-state">
              <h3 className="section-title">Select a person</h3>
              <p className="section-lede">Choose someone on the left to change their role or permissions.</p>
            </div>
          ) : (
            <>
              <div className="panel-header-row">
                <div>
                  <h3 className="section-title">{selected.name}</h3>
                  <p className="muted subtle">{selected.email}</p>
                </div>
                {selected.id !== user.id ? (
                  <button type="button" className="ghost-btn danger-text" onClick={() => void onRemove(selected)}>
                    Remove from company
                  </button>
                ) : null}
              </div>

              <label className="field" style={{ marginTop: 12, maxWidth: 360 }}>
                <span className="field-label">Role</span>
                <select
                  value={selectedRole}
                  disabled={saving || selected.id === user.id}
                  onChange={(e) => setRoleDrafts((c) => ({ ...c, [selected.id]: e.target.value }))}
                >
                  <option value="AGENT">Agent — assigned campaigns only</option>
                  <option value="ORG_ADMIN">Admin — all campaigns and team</option>
                  <option value="ORG_OWNER">Owner — full control</option>
                </select>
              </label>

              {isAgentRole ? (
                <>
                  <h4 className="subsection-title" style={{ marginTop: 20 }}>Agent permissions</h4>
                  <div className="perm-grid">
                    {FUNCTION_PERMISSION_KEYS.map((key) => {
                      const allowed = draft[key] !== false;
                      return (
                        <label key={key} className={`perm-tile${allowed ? " perm-tile--on" : ""}`}>
                          <input
                            type="checkbox"
                            checked={allowed}
                            disabled={saving}
                            onChange={(e) => updateDraft(selected.id, key, e.target.checked)}
                          />
                          <span className="perm-tile__copy">
                            <span className="perm-tile__title">{FUNCTION_LABELS[key].title}</span>
                            <span className="perm-tile__detail">{FUNCTION_LABELS[key].detail}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="callout callout-info" style={{ marginTop: 16 }}>
                  Owners and admins have full access to every feature in the company.
                </p>
              )}

              <div className="btn-row" style={{ marginTop: 18 }}>
                <button className="primary" type="button" disabled={!hasChanges || saving} onClick={() => void saveSelected()}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={!hasChanges || saving}
                  onClick={() => {
                    setDrafts((c) => ({ ...c, [selected.id]: selected.permissions }));
                    setRoleDrafts((c) => ({ ...c, [selected.id]: roleOf(selected) }));
                  }}
                >
                  Undo
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
