"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ScrollText, Archive, ArchiveRestore } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { api } from "@/lib/api";

type Owner = {
  id: string;
  name: string;
  phone?: string;
  cnic?: string;
  address?: string;
  is_archived: boolean;
};

type Account = { id: string; code: string; name: string };
type BuildingRow = { id: string; name: string; owner_id?: string };
type RoomRow = { id: string; building_id: string; room_number: string; owner_id?: string };

export default function OwnersPage() {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [dueToOwnersAccountId, setDueToOwnersAccountId] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", cnic: "", address: "" });

  function load() {
    api.get<Owner[]>(`/owners${showArchived ? "?include_archived=true" : ""}`).then(setOwners);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    api.get<Account[]>("/chart-of-accounts").then((accounts) => {
      const dueToOwners = accounts.find((a) => a.code === "2200");
      if (dueToOwners) setDueToOwnersAccountId(dueToOwners.id);
    });
    api.get<BuildingRow[]>("/buildings").then(setBuildings);
    api.get<RoomRow[]>("/rooms").then(setRooms);
  }, []);

  // A building's default owner, plus any room whose owner_id overrides that
  // default (rooms.owner_id wins over buildings.owner_id -- same rule the
  // ledger's resolve_room_owner() uses). Returns a short readable summary
  // like "Sunrise Plaza, Green Heights" or "Sunrise Plaza — Room 12".
  function propertiesFor(ownerId: string): string {
    const ownedBuildings = buildings.filter((b) => b.owner_id === ownerId);
    const ownedBuildingIds = new Set(ownedBuildings.map((b) => b.id));
    const ownedRooms = rooms.filter(
      (r) => r.owner_id === ownerId && !ownedBuildingIds.has(r.building_id)
    );
    const parts = [
      ...ownedBuildings.map((b) => b.name),
      ...ownedRooms.map((r) => {
        const building = buildings.find((b) => b.id === r.building_id);
        return `${building?.name ?? "—"} — Room ${r.room_number}`;
      }),
    ];
    return parts.length ? parts.join(", ") : "—";
  }

  function openLedger(owner: Owner) {
    if (!dueToOwnersAccountId) return;
    router.push(`/ledger?account_id=${dueToOwnersAccountId}&owner_id=${owner.id}`);
  }

  function openAddModal() {
    setEditingId(null);
    setError(null);
    setForm({ name: "", phone: "", cnic: "", address: "" });
    setModalOpen(true);
  }

  function openEditModal(owner: Owner) {
    setEditingId(owner.id);
    setError(null);
    setForm({
      name: owner.name,
      phone: owner.phone ?? "",
      cnic: owner.cnic ?? "",
      address: owner.address ?? "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name,
      phone: form.phone || undefined,
      cnic: form.cnic || undefined,
      address: form.address || undefined,
    };
    try {
      if (editingId) {
        await api.patch(`/owners/${editingId}`, payload);
      } else {
        await api.post("/owners", payload);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(owner: Owner) {
    await api.post(`/owners/${owner.id}/${owner.is_archived ? "unarchive" : "archive"}`, {});
    load();
  }

  const filtered = (owners ?? []).filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.name.toLowerCase().includes(q) ||
      (o.phone ?? "").toLowerCase().includes(q) ||
      (o.cnic ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Owners</h1>
          <p className="text-sm text-ink/55 mt-1">
            Everyone rent gets paid out to — assign them to a building or an
            individual room from the Buildings page.
          </p>
        </div>
        <Button onClick={openAddModal}>Add owner</Button>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4 no-print gap-3 flex-wrap">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or CNIC…"
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
          rows={filtered}
          emptyMessage={search ? "No owners match that search." : "No owners yet."}
          columns={[
            { header: "Name", accessor: (o) => o.name },
            { header: "Property", accessor: (o) => <span className="text-xs text-ink/70">{propertiesFor(o.id)}</span> },
            { header: "Phone", accessor: (o) => o.phone ?? "—" },
            { header: "CNIC", accessor: (o) => o.cnic ?? "—" },
            { header: "Address", accessor: (o) => o.address ?? "—" },
            {
              header: "",
              accessor: (o) => (
                <div className="flex gap-1 justify-end no-print">
                  <button onClick={() => openLedger(o)} title="View ledger" className="p-1.5 rounded hover:bg-ledger/5 text-ink/50 hover:text-ink">
                    <ScrollText size={16} />
                  </button>
                  <button onClick={() => openEditModal(o)} title="Edit" className="p-1.5 rounded hover:bg-ledger/5 text-ink/50 hover:text-ink">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleArchive(o)} title={o.is_archived ? "Unarchive" : "Archive"} className="p-1.5 rounded hover:bg-ledger/5 text-ink/50 hover:text-ink">
                    {o.is_archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                </div>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit owner" : "Add owner"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Phone (optional)">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="CNIC (optional)">
            <Input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
          </Field>
          <Field label="Address (optional)">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add owner"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
