/** Honest SMS attempt label — maps duplicate-window skips away from FAILED. */
export function formatSmsStatus(attempt: {
  status: string;
  rawPayload?: unknown;
}): string {
  const reason =
    attempt.rawPayload &&
    typeof attempt.rawPayload === "object" &&
    attempt.rawPayload !== null &&
    "reason" in attempt.rawPayload
      ? String((attempt.rawPayload as { reason?: unknown }).reason ?? "")
      : "";
  if (reason === "DUPLICATE_WITHIN_WINDOW") {
    return "Skipped — already texted (15 days)";
  }
  if (reason === "DNC") {
    return "Skipped — on DNC list";
  }
  return attempt.status;
}

/** User-facing date/time from an ISO string (API / Prisma). */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function formatRelativeDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}
