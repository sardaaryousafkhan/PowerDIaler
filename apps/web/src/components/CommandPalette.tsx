import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AdminAccessUserRow } from "../api.js";
import { useAuth } from "../authContext.js";
import { AppLogoMark } from "./AppLogo.js";
import { IconSearch } from "../icons/index.js";

export const HELP_URL = "/help/index.html";

type Cmd = { id: string; label: string; path: string; group: string; preview?: string };

type CampaignRow = { id: string; name: string };

function fuzzyIncludes(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return true;
  if (h.includes(n)) return true;
  // simple subsequence match for short typos
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i >= n.length) return true;
  }
  return false;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [members, setMembers] = useState<AdminAccessUserRow[]>([]);
  const cachedOpen = useRef(false);

  const commands = useMemo(() => {
    const list: Cmd[] = [
      { id: "dash", label: "Dashboard", path: "/dashboard", group: "Workspace", preview: "Pace and outcomes" },
      { id: "camps", label: "Campaigns", path: "/campaigns", group: "Workspace", preview: "All campaigns" },
    ];
    if (can("campaign_create"))
      list.push({ id: "new", label: "New campaign", path: "/new", group: "Workspace", preview: "Start dialing or SMS" });
    if (can("integrations_manage"))
      list.push({ id: "int", label: "Integrations", path: "/integrations", group: "Workspace" });
    if (can("crm_manage")) list.push({ id: "crm", label: "CRM", path: "/crm", group: "Workspace" });
    if (can("dnc_manage")) list.push({ id: "dnc", label: "DNC", path: "/dnc", group: "Workspace" });
    if (can("company_settings"))
      list.push({ id: "org", label: "Org settings", path: "/org/settings", group: "Company" });
    if (can("members_manage"))
      list.push({ id: "members", label: "Members", path: "/portal/admin", group: "Company", preview: "People & roles" });
    if (can("billing_view"))
      list.push({ id: "billing", label: "Billing", path: "/org/billing", group: "Company", preview: "Plan & seats" });
    list.push({ id: "lic", label: "License", path: "/license", group: "Company" });
    list.push({
      id: "user-portal",
      label: "User portal",
      path: "/portal/user",
      group: "Account",
      preview: "Profile & password",
    });
    list.push({
      id: "workspace-settings",
      label: "Workspace settings",
      path: "/dashboard/settings",
      group: "Settings",
    });
    list.push({
      id: "help",
      label: "Help",
      path: HELP_URL,
      group: "Help",
      preview: "Operator docs",
    });
    return list;
  }, [can]);

  useEffect(() => {
    if (!open) {
      cachedOpen.current = false;
      return;
    }
    setQ("");
    setActive(0);
    if (cachedOpen.current) return;
    cachedOpen.current = true;
    void api.campaigns
      .list()
      .then((rows) => {
        const mapped = (rows as Array<{ id?: string; name?: string }>)
          .filter((r) => typeof r.id === "string" && typeof r.name === "string")
          .map((r) => ({ id: r.id as string, name: r.name as string }));
        setCampaigns(mapped);
      })
      .catch(() => setCampaigns([]));
    if (can("members_manage")) {
      void api.adminAccess
        .listUsers()
        .then((r) => setMembers(r.users ?? []))
        .catch(() => setMembers([]));
    } else {
      setMembers([]);
    }
  }, [open, can]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out: Cmd[] = [];

    if (!s) {
      return commands;
    }

    for (const c of commands) {
      if (
        c.label.toLowerCase().includes(s) ||
        c.group.toLowerCase().includes(s) ||
        (c.preview?.toLowerCase().includes(s) ?? false)
      ) {
        out.push(c);
      }
    }

    // Billing / plan keyword even if static Billing row already matched
    if (
      can("billing_view") &&
      (s.includes("billing") || s.includes("plan") || s.includes("seat")) &&
      !out.some((c) => c.id === "billing")
    ) {
      out.push({
        id: "billing-query",
        label: "Go to Billing",
        path: "/org/billing",
        group: "Company",
        preview: "Plan & seats",
      });
    }

    for (const camp of campaigns) {
      if (fuzzyIncludes(camp.name, s)) {
        out.push({
          id: `camp-${camp.id}`,
          label: camp.name,
          path: `/campaigns/${camp.id}`,
          group: "Go to campaign",
          preview: "Open campaign",
        });
      }
    }

    if (can("members_manage")) {
      for (const m of members) {
        if (fuzzyIncludes(m.name, s) || fuzzyIncludes(m.email, s)) {
          out.push({
            id: `member-${m.id}`,
            label: `Open Members · ${m.name || m.email}`,
            path: "/portal/admin",
            group: "Members",
            preview: m.email,
          });
        }
      }
    }

    return out;
  }, [commands, q, campaigns, members, can]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;

  function go(path: string): void {
    if (path.startsWith("/help") || path.endsWith(".html")) {
      window.location.assign(path);
      onClose();
      return;
    }
    navigate(path);
    onClose();
  }

  return (
    <div
      className="cmdk-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk__input-wrap">
          <span className="cmdk-mark-watermark" aria-hidden>
            <AppLogoMark size={48} />
          </span>
          <IconSearch size={18} />
          <input
            className="cmdk__input"
            autoFocus
            placeholder="Go to…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[active]) go(filtered[active].path);
            }}
          />
        </div>
        <div className="cmdk__list">
          {filtered.length === 0 ? (
            <div className="cmdk__empty">No matches.</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className="cmdk__row pressable"
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c.path)}
              >
                <span className="caption" style={{ color: "var(--text-low)", width: 72, flexShrink: 0 }}>
                  {c.group}
                </span>
                <span style={{ flex: 1, textAlign: "left" }}>{c.label}</span>
                {c.preview ? (
                  <span className="caption" style={{ color: "var(--text-low)" }}>
                    {c.preview}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
