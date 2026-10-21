import { getIntegrationCatalogEntry, type IntegrationCapability, type IntegrationProviderId } from "@powerdialer/shared";

type HealthKey = `${IntegrationProviderId}:${string}:${IntegrationCapability}`;

const failureState = new Map<HealthKey, { failures: number; openUntil: number }>();

const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;

function key(provider: IntegrationProviderId, country: string, capability: IntegrationCapability): HealthKey {
  return `${provider}:${country}:${capability}`;
}

function supports(provider: IntegrationProviderId, capability: IntegrationCapability): boolean {
  const entry = getIntegrationCatalogEntry(provider);
  return entry.adapterStatus === "live" && entry.capabilities.includes(capability);
}

export function selectProviderForCountry(args: {
  preferred: IntegrationProviderId;
  country: string;
  capability: IntegrationCapability;
  fallback?: IntegrationProviderId;
}): IntegrationProviderId {
  const { preferred, country, capability, fallback } = args;
  if (!supports(preferred, capability)) {
    if (fallback && supports(fallback, capability)) return fallback;
    return preferred;
  }
  const state = failureState.get(key(preferred, country, capability));
  if (state && state.openUntil > Date.now() && fallback && supports(fallback, capability)) {
    return fallback;
  }
  return preferred;
}

export function recordProviderOutcome(args: {
  provider: IntegrationProviderId;
  country: string;
  capability: IntegrationCapability;
  ok: boolean;
  retryableFailure: boolean;
}): void {
  const k = key(args.provider, args.country, args.capability);
  if (args.ok || !args.retryableFailure) {
    failureState.delete(k);
    return;
  }
  const prev = failureState.get(k) ?? { failures: 0, openUntil: 0 };
  const failures = prev.failures + 1;
  const openUntil = failures >= CIRCUIT_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : prev.openUntil;
  failureState.set(k, { failures, openUntil });
}
