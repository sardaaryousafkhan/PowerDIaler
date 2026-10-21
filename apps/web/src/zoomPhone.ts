/** Opens Zoom Phone desktop client to dial (requires Zoom logged in). */
export function buildZoomPhoneCallUrl(toE164: string, fromE164?: string): string {
  const to = toE164.trim();
  const encodedTo = encodeURIComponent(to);
  const from = fromE164?.trim();
  if (from) {
    return `zoomphonecall://${encodedTo}?callerid=${encodeURIComponent(from)}`;
  }
  return `zoomphonecall://${encodedTo}`;
}

export function openZoomPhoneCall(toE164: string, fromE164?: string): void {
  window.location.href = buildZoomPhoneCallUrl(toE164, fromE164);
}
