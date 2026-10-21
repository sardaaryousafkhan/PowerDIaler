import { api } from "./api.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetches `/integrations` with short exponential backoff (used on mount and manual retry).
 */
export async function fetchIntegrationsWithRetries(): Promise<
  { ok: true; data: Awaited<ReturnType<typeof api.integrations.get>> } | { ok: false; error: Error }
> {
  let lastErr: Error = new Error("Unknown error");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await api.integrations.get();
      return { ok: true, data };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < 3) await sleep(350 * (attempt + 1));
    }
  }
  return { ok: false, error: lastErr };
}
