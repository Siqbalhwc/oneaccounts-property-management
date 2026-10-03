// Shared types + helpers for the Roommates and Facility-specs features.

export type Roommate = {
  id: string;
  tenant_id: string;
  room_id: string;
  lease_id?: string | null;
  full_name: string;
  relationship?: string | null;
  cnic?: string | null;
  phone?: string | null;
  address?: string | null;
  moved_in_date: string;
  moved_out_date?: string | null;
  removal_reason?: string | null;
};

export type RoommateReportRow = {
  tenant_id: string;
  tenant_name?: string;
  tenant_cnic?: string;
  tenant_phone?: string;
  lease_id: string;
  room_id: string;
  room_number?: string;
  building_id?: string;
  building_name?: string;
  current_roommate_count: number;
  roommates: Roommate[];
};

export type RoommateReport = {
  rows: RoommateReportRow[];
  total_tenants: number;
  total_current_roommates: number;
};

export type FacilityKind = "parking" | "internet" | "electricity" | "water" | "gas" | "other";

export type TemplateField = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  unit?: string;
  placeholder?: string;
};

export type FacilityTemplates = Record<FacilityKind, { label: string; hint: string; fields: TemplateField[] }>;

export type Facility = {
  id: string;
  lease_id: string;
  tenant_id: string;
  room_id: string;
  label: string;
  kind: FacilityKind;
  specs: Record<string, string | number>;
  specs_display: { label: string; value: string | number; unit?: string | null }[];
  notes?: string | null;
  is_active: boolean;
  ended_on?: string | null;
};

export type FacilityRegisterRow = Facility & {
  tenant_name?: string;
  tenant_phone?: string;
  room_number?: string;
  building_id?: string;
  building_name?: string;
  lease_status?: string;
};

export type FacilityRegister = {
  rows: FacilityRegisterRow[];
  total: number;
  counts_by_kind: Record<FacilityKind, number>;
};

/** Mirrors the backend's classify_label() so the form shows the right fields
 *  as soon as a facility name is typed. The backend remains the authority. */
export function classifyLabel(label: string): FacilityKind {
  const l = (label || "").toLowerCase();
  if (l.includes("park")) return "parking";
  if (["internet", "wifi", "wi-fi", "broadband"].some((w) => l.includes(w))) return "internet";
  if (["electric", "power"].some((w) => l.includes(w))) return "electricity";
  if (l.includes("water")) return "water";
  if (l.includes("gas")) return "gas";
  return "other";
}

export function formatSpecValue(d: { value: string | number; unit?: string | null }) {
  return d.unit ? `${d.value} ${d.unit}` : String(d.value);
}
