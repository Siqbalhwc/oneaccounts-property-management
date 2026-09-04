"use client";

import { useEffect, useState } from "react";
import { api, Tenant, Profile, Lease, Room, Building } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { Field, Input } from "@/components/ui/Field";

function validateCnic(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 13) return "CNIC must be exactly 13 digits (e.g. 35202-1234567-1).";
  return null;
}

function validatePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 && digits.length !== 10) {
    return "Enter a valid Pakistani mobile number (e.g. 0300-1234567).";
  }
  if (digits.length === 11 && !digits.startsWith("0")) {
    return "An 11-digit number should start with 0 (e.g. 0300-1234567).";
  }
  return null;
}

const emptyForm = { full_name: "", cnic: "", phone: "", email: "", address: "" };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [leases, setLeases] = useState<Lease[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState({ cnic: false, phone: false });

  const [archiveTarget, setArchiveTarget] = useState<Tenant | null>(null);
  const [archiving, setArchiving] = useState(false);

  function load() {
    api.get<Tenant[]>(`/tenants${showArchived ? "?include_archived=true" : ""}`).then(setTenants);
  }

  useEffect(load, [showArchived]);
  useEffect(() => {
    api.get<Profile>("/profile/me").then((p) => setMyRole(p.role));
    api.get<Lease[]>("/leases").then(setLeases);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Building[]>("/buildings").then(setBuildings);
  }, []);

  const canManage = myRole === "owner" || myRole === "admin";

  // Property the tenant currently lives in, via their active lease. A
  // tenant can only have one active lease at a time (enforced at lease
  // creation), so the first active match is the right one.
  function propertyFor(tenantId: string): string {
    const activeLease = leases.find((l) => l.tenant_id === tenantId && l.status === "active");
    if (!activeLease) return "Not assigned";
    const room = rooms.find((r) => r.id === activeLease.room_id);
    const building = buildings.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — Apartment ${room.room_number}` : "Not assigned";
  }

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredTenants = (tenants ?? []).filter((t) => {
    if (!normalizedSearch) return true;
    const haystacks = [t.full_name, t.cnic, t.address ?? ""];
    return haystacks.some((field) => field.toLowerCase().includes(normalizedSearch));
  });

  const cnicError = touched.cnic ? validateCnic(form.cnic) : null;
  const phoneError = touched.phone ? validatePhone(form.phone) : null;
  const canSubmit =
    form.full_name.trim() !== "" && validateCnic(form.cnic) === null && validatePhone(form.phone) === null;

  function openAddModal() {
    setEditingId(null);
    setError(null);
    setForm(emptyForm);
    setTouched({ cnic: false, phone: false });
    setModalOpen(true);
  }

  function openEditModal(tenant: Tenant) {
    setEditingId(tenant.id);
    setError(null);
    setForm({
      full_name: tenant.full_name,
      cnic: tenant.cnic,
      phone: tenant.phone,
      email: tenant.email ?? "",
      address: tenant.address ?? "",
    });
    setTouched({ cnic: true, phone: true });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ cnic: true, phone: true });
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.patch(`/tenants/${editingId}`, form);
      } else {
        await api.post("/tenants", form);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await api.post(`/tenants/${archiveTarget.id}/archive`, {});
      setArchiveTarget(null);
      load();
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Tenants</h1>
          <p className="text-sm text-ink/55 mt-1">
            Identified by CNIC — a tenant&apos;s record follows them across every
            apartment they&apos;ve rented.
          </p>
        </div>
        <Button onClick={openAddModal}>Add tenant</Button>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4 no-print gap-3 flex-wrap">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, CNIC, or address…"
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-xs text-ink/50">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        <DataTable
          keyField="id"
          rows={filteredTenants}
          emptyMessage={searchTerm ? "No tenants match your search." : "No tenants added yet."}
          columns={[
            {
              header: "Name",
              accessor: (t) => (
                <span className={`font-medium ${t.is_archived ? "opacity-50" : ""}`}>
                  {t.full_name} {t.is_archived && <span className="text-xs font-normal">(archived)</span>}
                </span>
              ),
            },
            { header: "CNIC", accessor: (t) => <span className="figures text-ink/70">{t.cnic}</span> },
            { header: "Phone", accessor: (t) => <span className="figures text-ink/70">{t.phone}</span> },
            {
              header: "Property",
              accessor: (t) => {
                const label = propertyFor(t.id);
                return (
                  <span className={`text-xs ${label === "Not assigned" ? "text-ink/40" : "text-ink/70"}`}>
                    {label}
                  </span>
                );
              },
            },
            { header: "Email", accessor: (t) => t.email ?? "—" },
            { header: "Address", accessor: (t) => t.address ?? "—" },
            {
              header: "",
              accessor: (t) => (
                <div className="flex justify-end gap-1 no-print">
                  <Button variant="ghost" onClick={() => openEditModal(t)}>
                    Edit
                  </Button>
                  {canManage && !t.is_archived && (
                    <Button variant="ghost" onClick={() => setArchiveTarget(t)}>
                      Archive
                    </Button>
                  )}
                </div>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit tenant" : "Add tenant"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Full name">
            <Input
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="CNIC" hint={cnicError ?? "e.g. 35202-1234567-1 (13 digits)"}>
            <Input
              required
              value={form.cnic}
              onChange={(e) => setForm({ ...form, cnic: e.target.value })}
              onBlur={() => setTouched({ ...touched, cnic: true })}
              placeholder="35202-1234567-1"
              className={cnicError ? "border-stamp-red" : ""}
            />
          </Field>
          <Field label="Phone" hint={phoneError ?? "e.g. 0300-1234567"}>
            <Input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onBlur={() => setTouched({ ...touched, phone: true })}
              placeholder="0300-1234567"
              className={phoneError ? "border-stamp-red" : ""}
            />
          </Field>
          <Field label="Email (optional)">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Address (optional)">
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !canSubmit}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add tenant"}
            </Button>
          </div>
          {editingId && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">History</p>
              <HistoryPanel tableName="tenants" recordId={editingId} />
            </div>
          )}
        </form>
      </Modal>

      <ConfirmModal
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        title="Archive tenant?"
        message={`"${archiveTarget?.full_name}" will be hidden from lists but all their lease and payment history stays intact. You can unarchive them later if needed.`}
        confirmLabel="Archive"
        confirming={archiving}
      />
    </div>
  );
}
