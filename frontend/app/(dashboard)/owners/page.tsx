"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ScrollText, Archive, ArchiveRestore, Banknote } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput } from "@/components/ui/Field";
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
// Straight from the Due to Owners (2200) account's real journal_lines --
// see backend /owner-ledger/balances -- so this can never disagree with
// what "View ledger" shows for the same owner.
type OwnerBalance = { owner_id: string; balance: number };

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function OwnersPage() {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [dueToOwnersAccountId, setDueToOwnersAccountId] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [balances, setBalances] = useState<OwnerBalance[]>([]);

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", cnic: "", address: "" });

  // Pay flow -- posts straight to the ledger (Dr Due to Owners / Cr Bank),
  // no separate snapshot table involved.
  const [payOwner, setPayOwner] = useState<Owner | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ amount_paid: "", paid_date: "" });

  function load() {
    api.get<Owner[]>(`/owners${showArchived ? "?include_archived=true" : ""}`).then(setOwners);
  }

  function loadBalances() {
    api.get<OwnerBalance[]>("/owner-ledger/balances").then(setBalances);
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
    loadBalances();
  }, []);

  function balanceFor(ownerId: string): number {
    return balances.find((b) => b.owner_id === ownerId)?.balance ?? 0;
  }

  function openPay(owner: Owner) {
    setPayError(null);
    const balance = balanceFor(owner.id);
    setPayForm({ amount_paid: balance > 0 ? String(balance) : "", paid_date: new Date().toISOString().slice(0, 10) });
    setPayOwner(owner);
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payOwner) return;
    setPaySaving(true);
    setPayError(null);
    try {
      await api.post("/owner-ledger/pay-owner", {
        owner_id: payOwner.id,
        amount_paid: parseFloat(payForm.amount_paid || "0"),
        paid_date: payForm.paid_date,
      });
      setPayOwner(null);
      loadBalances();
    } catch (err: any) {
      setPayError(err.message);
    } finally {
      setPaySaving(false);
    }
  }

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
        return `${building?.name ?? "—"} — Apartment ${r.room_number}`;
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
            individual apartment from the Buildings page.
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
            {
              header: "Balance due",
              accessor: (o) => {
                const balance = balanceFor(o.id);
                if (balance <= 0) return <span className="text-ink/40">—</span>;
                return <span className="figures font-medium text-stamp-red">{formatPkr(balance)}</span>;
              },
              align: "right",
            },
            {
              header: "",
              accessor: (o) => (
                <div className="flex gap-1 justify-end no-print">
                  {balanceFor(o.id) > 0 && (
                    <button onClick={() => openPay(o)} title="Pay owner" className="p-1.5 rounded hover:bg-ledger/5 text-ink/50 hover:text-ink">
                      <Banknote size={16} />
                    </button>
                  )}
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

      <Modal open={!!payOwner} onClose={() => setPayOwner(null)} title={payOwner ? `Pay ${payOwner.name}` : "Pay owner"}>
        <form onSubmit={handlePay} className="space-y-4">
          {payOwner && (
            <p className="text-xs text-ink/50 bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2">
              Current balance owed: <span className="figures font-medium">{formatPkr(balanceFor(payOwner.id))}</span>
            </p>
          )}
          <Field label="Amount to pay now">
            <AmountInput
              required
              value={payForm.amount_paid}
              onChange={(e) => setPayForm({ ...payForm, amount_paid: e.target.value })}
            />
          </Field>
          <Field label="Date paid">
            <Input
              type="date"
              required
              value={payForm.paid_date}
              onChange={(e) => setPayForm({ ...payForm, paid_date: e.target.value })}
            />
          </Field>
          {payError && <p className="text-sm text-stamp-red">{payError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPayOwner(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={paySaving}>
              {paySaving ? "Saving…" : "Record payout"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
