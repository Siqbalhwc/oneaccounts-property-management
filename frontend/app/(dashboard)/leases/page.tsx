"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Lease, Tenant, Room, Building } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { Field, Input } from "@/components/ui/Field";

export default function LeasesPage() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [editForm, setEditForm] = useState({ start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Lease[]>("/leases").then(setLeases);
  }

  useEffect(() => {
    load();
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Building[]>("/buildings").then(setBuildings);
  }, []);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? "—";
  const roomAndBuilding = (roomId: string) => {
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };

  function openEditModal(lease: Lease) {
    setEditingLease(lease);
    setEditForm({ start_date: lease.start_date, end_date: lease.end_date });
    setError(null);
    setEditModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLease) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/leases/${editingLease.id}`, editForm);
      setEditModalOpen(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Leases</h1>
          <p className="text-sm text-ink/55 mt-1">
            One-year agreements linking a tenant to a room, with their rent
            structure and security deposit.
          </p>
        </div>
        <Link href="/leases/new">
          <Button>New lease</Button>
        </Link>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={leases ?? []}
          emptyMessage="No leases yet — create one to get started."
          columns={[
            { header: "Tenant", accessor: (l) => <span className="font-medium">{tenantName(l.tenant_id)}</span> },
            { header: "Building / Room", accessor: (l) => roomAndBuilding(l.room_id) },
            { header: "Start date", accessor: (l) => l.start_date },
            { header: "End date", accessor: (l) => l.end_date },
            { header: "Status", accessor: (l) => <StampBadge status={l.status} /> },
            {
              header: "",
              accessor: (l) => (
                <Button variant="ghost" onClick={() => openEditModal(l)} className="no-print">
                  Edit dates
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit lease dates">
        <form onSubmit={handleSave} className="space-y-4">
          <p className="text-xs text-ink/50">
            {editingLease && tenantName(editingLease.tenant_id)} — {editingLease && roomAndBuilding(editingLease.room_id)}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date">
              <Input
                type="date"
                required
                value={editForm.start_date}
                onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                required
                value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
              />
            </Field>
          </div>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
          {editingLease && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">History</p>
              <HistoryPanel tableName="leases" recordId={editingLease.id} />
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}
