import { supabase } from "./supabaseClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const bodyText = await res.text();
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      // body wasn't JSON (e.g. an HTML error page) -- fall back to raw text
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// For endpoints that don't require a session yet (e.g. signup itself).
export async function postPublic<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      // not JSON, use raw text
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Multipart upload (e.g. logo) needs its own path -- no JSON content-type,
// and the browser must set its own multipart boundary header.
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const headers = await authHeader();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers, // no Content-Type here on purpose
    body: formData,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetches a PDF as a blob (needs the auth header, so a plain <a href> won't work)
export async function fetchPdfBlob(path: string): Promise<Blob> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.blob();
}

export type Company = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  logo_url?: string;
};

export type Profile = {
  id: string;
  full_name: string;
  role: string;
  phone?: string;
};

// ---------------------------------------------------------------------------
// Domain types (mirror the backend's tables — kept simple/loose on purpose)
// ---------------------------------------------------------------------------
export type Building = {
  id: string;
  name: string;
  address?: string;
  owner_name?: string;
  owner_phone?: string;
  is_archived?: boolean;
};

export type Floor = {
  id: string;
  building_id: string;
  floor_number: number;
  name?: string;
};

export type Room = {
  id: string;
  building_id: string;
  floor_id: string;
  room_number: string;
  room_type?: string;
  status: "vacant" | "occupied" | "under_maintenance" | "reserved";
  base_rent?: number;
  is_archived?: boolean;
};

export type Tenant = {
  id: string;
  cnic: string;
  full_name: string;
  phone: string;
  email?: string;
  address?: string;
  is_archived?: boolean;
};

export type Lease = {
  id: string;
  tenant_id: string;
  room_id: string;
  start_date: string;
  end_date: string;
  status: "active" | "terminated" | "expired";
};

export type Invoice = {
  id: string;
  lease_id: string;
  invoice_number?: string;
  invoice_month: string;
  due_date: string;
  total_amount: number;
  status: "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled";
  created_at?: string;
};

export type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  transfers_to_owner: boolean;
};

export type SecurityDeposit = {
  id: string;
  lease_id: string;
  amount_received: number;
  date_received: string;
  status: "held" | "partially_refunded" | "refunded";
  amount_refunded?: number;
  date_refunded?: string;
  is_received: boolean;
  received_account_id?: string | null;
};
