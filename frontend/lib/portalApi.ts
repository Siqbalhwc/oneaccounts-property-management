// Client for the TENANT portal. Completely separate from lib/api.ts (which is for staff and uses
// Supabase sessions): tenants have no Supabase session, only a portal token kept for this tab.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;
const tokenKey = (code: string) => `oa_portal_token_${code}`;

export class PortalAuthError extends Error {}

export const portalToken = {
  get: (code: string) => {
    try { return window.sessionStorage.getItem(tokenKey(code)); } catch { return null; }
  },
  set: (code: string, token: string) => {
    try { window.sessionStorage.setItem(tokenKey(code), token); } catch { /* storage blocked */ }
  },
  clear: (code: string) => {
    try { window.sessionStorage.removeItem(tokenKey(code)); } catch { /* ignore */ }
  },
};

export async function portalRequest<T>(code: string, path: string, options: RequestInit = {}, withToken = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withToken) {
    const token = portalToken.get(code);
    if (!token) throw new PortalAuthError("Please sign in.");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const parsed = await res.json();
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch { /* not JSON */ }
    if (withToken && res.status === 401) {
      portalToken.clear(code);
      throw new PortalAuthError(message);
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type PortalMe = {
  tenant_name: string;
  masked_username: string;
  company_name: string;
  logo_url: string | null;
  unit_type: string;
  must_change_password: boolean;
  permissions: Record<string, boolean>;
};
