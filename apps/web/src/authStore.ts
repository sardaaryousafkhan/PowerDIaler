const TOKEN_KEY = "pd_auth_token";

export function readAuthToken(): string | null {
  const t = localStorage.getItem(TOKEN_KEY);
  return t && t.trim().length ? t : null;
}

export function writeAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
