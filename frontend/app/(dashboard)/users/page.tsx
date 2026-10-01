"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";

type UserRow = {
  id: string;
  full_name: string;
  email?: string | null;
  role: string;
  role_label: string;
  is_suspended?: boolean;
  building_ids: string[];
};
type BuildingLite = { id: string; name: string };
type RoleOption = { value: string; label: string };
type CompanyLite = { id: string; name: string };
type UsersResponse = {
  company: { id: string; name: string; access_control_enabled: boolean } | null;
  users: UserRow[];
};

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, in every building.",
  admin: "Post entries, create buildings/rooms/tenants/leases, WhatsApp, edit, archive, reverse.",
  accountant: "Post entries only (payments, invoices, expenses, journals). Cannot create or edit master data.",
  auditor: "View-only: dashboard, details and all reports, incl. financial statements. No data entry.",
  manager: "Legacy role — behaves like Admin.",
  staff: "Legacy role — behaves like Accountant.",
};

const emptyForm = { full_name: "", email: "", password: "", role: "accountant", building_ids: [] as string[] };

export default function UsersPage() {
  const access = useAccess();
  const isPlatform = !!access?.is_platform_admin;

  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [data, setData] = useState<UsersResponse | null>(null);
  const [buildings, setBuildings] = useState<BuildingLite[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [suspended, setSuspended] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const q = companyId ? `?company_id=${companyId}` : "";
  const ready = !isPlatform || !!companyId;

  useEffect(() => {
    if (isPlatform) {
      api.get<CompanyLite[]>("/platform/companies").then((c) => {
        setCompanies(c);
        if (c.length && !companyId) setCompanyId(c[0].id);
      });
    }
    api.get<RoleOption[]>("/access/roles").then(setRoles).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatform]);

  function load() {
    if (!ready) return;
    setLoadError(null);
    api.get<UsersResponse>(`/access/users${q}`).then(setData).catch((e) => setLoadError(e.message));
    api.get<BuildingLite[]>(`/access/buildings${q}`).then(setBuildings).catch(() => {});
  }
  useEffect(load, [companyId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildingName = useMemo(() => {
    const m = new Map(buildings.map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [buildings]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setSuspended(false);
    setError(null);
    setModalOpen(true);
  }
  function openEdit(u: UserRow) {
    setEditing(u);
    setForm({ full_name: u.full_name, email: u.email ?? "", password: "", role: u.role, building_ids: u.building_ids });
    setSuspended(!!u.is_suspended);
    setError(null);
    setModalOpen(true);
  }
  function toggleBuilding(id: string) {
    setForm((f) => ({
      ...f,
      building_ids: f.building_ids.includes(id) ? f.building_ids.filter((b) => b !== id) : [...f.building_ids, id],
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const buildingIds = form.role === "owner" ? [] : form.building_ids;
    try {
      if (editing) {
        await api.patch(`/access/users/${editing.id}${q}`, {
          full_name: form.full_name,
          role: form.role,
          building_ids: buildingIds,
          is_suspended: suspended,
        });
      } else {
        await api.post("/access/users", {
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          role: form.role,
          building_ids: buildingIds,
          company_id: companyId || undefined,
        });
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleFeature() {
    if (!data?.company) return;
    const next = !data.company.access_control_enabled;
    const msg = next
      ? `Switch Access Control ON for ${data.company.name}?\n\nRoles and building limits start being enforced immediately. Users with no buildings assigned still see everything.`
      : `Switch Access Control OFF for ${data.company.name}?\n\nEveryone goes back to seeing and doing everything, as before.`;
    if (!window.confirm(msg)) return;
    setToggling(true);
    try {
      await api.put(`/access/company/${data.company.id}/enabled`, { enabled: next });
      load();
    } catch (err: any) {
      setLoadError(err.message);
    } finally {
      setToggling(false);
    }
  }

  if (access && !access.can_manage_users) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-display font-semibold">Users &amp; access</h1>
        <Card>
          <p className="text-sm text-ink/60">Only the company owner can manage users and their access.</p>
        </Card>
      </div>
    );
  }

  const enabled = !!data?.company?.access_control_enabled;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Users &amp; access</h1>
          <p className="text-sm text-ink/55 mt-1">
            Give each person a role, and optionally limit them to specific buildings. Anyone with no buildings ticked
            sees every building.
          </p>
        </div>
        <Button onClick={openAdd} disabled={!ready}>
          Add user
        </Button>
      </div>

      {isPlatform && (
        <Card>
          <Field label="Company">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      )}

      {data?.company && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                Access Control is{" "}
                <span className={enabled ? "text-ledger font-semibold" : "text-ink/50 font-semibold"}>
                  {enabled ? "ON" : "OFF"}
                </span>{" "}
                for {data.company.name}
              </p>
              <p className="text-xs text-ink/50 mt-1">
                {enabled
                  ? "Roles and building limits below are being enforced."
                  : "Nothing below is enforced yet — everyone still sees and does everything. You can prepare roles and buildings now."}
              </p>
            </div>
            {isPlatform ? (
              <Button variant="secondary" onClick={toggleFeature} disabled={toggling}>
                {toggling ? "Saving…" : enabled ? "Switch off" : "Switch on"}
              </Button>
            ) : (
              !enabled && <p className="text-xs text-ink/45">Ask the platform admin to switch it on.</p>
            )}
          </div>
        </Card>
      )}

      {loadError && <p className="text-sm text-stamp-red">{loadError}</p>}

      <Card>
        <DataTable
          keyField="id"
          rows={data?.users ?? []}
          emptyMessage="No users yet."
          columns={[
            {
              header: "Name",
              accessor: (u) => (
                <div className={u.is_suspended ? "opacity-50" : ""}>
                  <p className="font-medium">
                    {u.full_name} {u.is_suspended && <span className="text-xs font-normal">(suspended)</span>}
                  </p>
                  <p className="text-xs text-ink/50">{u.email ?? ""}</p>
                </div>
              ),
            },
            { header: "Role", accessor: (u) => u.role_label },
            {
              header: "Buildings",
              accessor: (u) =>
                u.role === "owner" || u.building_ids.length === 0 ? (
                  <span className="text-ink/50">All buildings</span>
                ) : (
                  <span title={u.building_ids.map(buildingName).join(", ")}>
                    {u.building_ids.length <= 2
                      ? u.building_ids.map(buildingName).join(", ")
                      : `${u.building_ids.length} buildings`}
                  </span>
                ),
            },
            {
              header: "",
              accessor: (u) => (
                <div className="flex justify-end no-print">
                  <button
                    onClick={() => openEdit(u)}
                    title="Edit role / buildings"
                    className="p-1.5 rounded hover:bg-ledger/5 text-ink/50 hover:text-ink"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit user" : "Add user"} size="full">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-wider text-ink/45 font-medium">Account</p>
              <Field label="Full name">
                <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  required={!editing}
                  disabled={!!editing}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              {!editing && (
                <Field label="Temporary password" hint="At least 8 characters. Share it with them securely.">
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Role" hint={ROLE_HELP[form.role]}>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {roles.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {editing && (
                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input type="checkbox" checked={suspended} onChange={(e) => setSuspended(e.target.checked)} />
                  Suspended (cannot sign in)
                </label>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-ink/45 font-medium">Buildings this user can see</p>
                {form.role !== "owner" && buildings.length > 0 && (
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="text-ledger hover:underline" onClick={() => setForm({ ...form, building_ids: buildings.map((b) => b.id) })}>
                      Select all
                    </button>
                    <button type="button" className="text-ink/50 hover:underline" onClick={() => setForm({ ...form, building_ids: [] })}>
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {form.role === "owner" ? (
                <p className="text-sm text-ink/55">An owner always sees every building.</p>
              ) : (
                <>
                  <div className="rounded-card border border-border max-h-72 overflow-y-auto divide-y divide-border">
                    {buildings.length === 0 && <p className="p-3 text-sm text-ink/45">No buildings yet.</p>}
                    {buildings.map((b) => (
                      <label key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-ledger/5">
                        <input type="checkbox" checked={form.building_ids.includes(b.id)} onChange={() => toggleBuilding(b.id)} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-ink/50">
                    {form.building_ids.length === 0
                      ? "None ticked = this user sees ALL buildings."
                      : `${form.building_ids.length} selected — this user sees only these buildings (and their rooms, tenants' leases, invoices, payments, expenses and journal lines).`}
                  </p>
                </>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add user"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
