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
  unit: string;
  units: string;
  must_change_password: boolean;
  permissions: Record<string, boolean>;
};

export type PortalInvoice = {
  id: string;
  lease_id: string;
  invoice_month: string;
  due_date: string | null;
  total: number;
  paid: number;
  balance: number;
  status: "paid" | "partial" | "overdue" | "due";
  items: { label: string; amount: number }[];
  room: { number: string; building: string | null } | null;
  request: { status: "open" | "resolved" | "declined"; message: string; reply: string | null; created_at: string } | null;
  can_request_change: boolean;
};

export type PortalLedgerRow = { date: string; description: string | null; debit: number; credit: number; balance: number; is_opening: boolean };

export function formatMoney(n: number): string {
  const v = Math.abs(n).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}Rs ${v}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatMonth(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Downloads a PDF that needs the portal token (so a plain link can't be used). */
export async function downloadPortalPdf(code: string, path: string, filename: string): Promise<void> {
  const token = portalToken.get(code);
  if (!token) throw new PortalAuthError("Please sign in.");
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401) { portalToken.clear(code); throw new PortalAuthError("Please sign in again."); }
    let message = "Couldn't download this file right now.";
    try { const p = await res.json(); if (typeof p.detail === "string") message = p.detail; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export type PortalClaim = {
  id: string;
  amount: number;
  payment_method: "cash" | "bank_transfer";
  paid_to: string | null;
  payment_date: string;
  reference: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reject_reason: string | null;
  approved_amount: number | null;
  receipt_group_id: string | null;
  invoice_months: string[];
  created_at: string;
};

export type PortalReceipt = { receipt_id: string; date: string; amount: number; method: string; invoice_months: string[] };

export type PortalRepair = {
  id: string;
  category: string | null;
  message: string;
  status: "open" | "in_progress" | "resolved" | "declined" | "cancelled";
  admin_reply: string | null;
  created_at: string;
  unit: { building: string | null; number: string } | null;
};

export type RepairOptions = { categories: string[]; units: { room_id: string; building: string | null; number: string }[] };
