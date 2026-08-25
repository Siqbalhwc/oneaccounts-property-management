"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ScrollText, Archive, ArchiveRestore, Banknote } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type Owner = {
  id: string;
  name: string;
  phone?: string;
  cnic?: string;
  address?: string;
  is_archived: boolean;
};

type Account = { id: string; code: string; name: string };

type LedgerRow = {
  id: string;
  owner_id: string;
  building_id: string;
  ledger_month: string;
  amount_payable: number;
  amount_paid: number;
  status: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function OwnersPage() {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [dueToOwnersAccountId, setDueToOwnersAccountId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", cnic: "", address: "" });

  // Pay flow: pick an owner -> see their outstanding ledger rows (one per
  // building/month, same shape as the Owner Ledger page) -> pay one.
  const [payListOwner, setPayListOwner] = useState<Owner | null>(null);
  const [payRow, setPayRow] = useState<LedgerRow | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ amount_paid: "", paid_date: "" });

  function load() {
    api.get<Owner[]>(`/owners${showArchived ? "?include_archived=true" : ""}`).then(setOwners);
  }

  function loadLedger() {
    api.get<LedgerRow[]>("/owner-ledger").then(setLedgerRows);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    loadLedger();
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Account[]>("/chart-of-accounts").then((accounts) => {
      const dueToOwners = accounts.find((a) => a.code === "2200");
      if (dueToOwners) setDueToOwnersAccountId(dueToOwners.id);
    });
  }, []);

  function openLedger(owner: Owner) {
    if (!dueToOwnersAccountId) return;
    router.push(`/ledger?account_id=${dueToOwnersAccountId}&owner_id=${owner.id}`);
  }

  function rowsForOwner(ownerId: string) {
    return (ledgerRows ?? []).filter((r) => r.owner_id === ownerId);
  }

  function ownerBalanceStatus(ownerId: string): { balance: number; status: string | null } {
    const rows = rowsForOwner(ownerId);
    if (rows.length === 0) return { balance: 0, status: null };
    const balance = rows.reduce((sum, r) => sum + (Number(r.amount_payable) - Number(r.amount_paid || 0)), 0);
    if (balance <= 0) return { balance, status: "paid" };
    const anyPaidSoFar = rows.some((r) => Number(r.amount_paid || 0) > 0);
    return { balance, status: anyPaidSoFar ? "partial" : "pending" };
  }

  function buildingName(id: string) {
    return buildings?.find((b) => b.id === id)?.name ?? "—";
  }

  function openPayList(owner: Owner) {
    setPayListOwner(owner);
  }

  function openPayForm(row: LedgerRow) {
    setPayError(null);
    const remaining = Number(row.amount_payable) - Number(row.amount_paid || 0);
    setPayForm({ amount_paid: String(remaining), paid_date: new Date().toISOString().slice(0, 10) });
    setPayRow(row);
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payRow) return;
    setPaySaving(true);
    setPayError(null);
    try {
      // Same convention as the Owner Ledger page: /pay records the running
      // total paid, so add this payment on top of whatever was already paid.
      const alreadyPaid = Number(payRow.amount_paid || 0);
      const newTotalPaid = alreadyPaid + parseFloat(payForm.amount_paid || "0");
      await api.post(`/owner-ledger/${payRow.id}/pay`, {
        amount_paid: newTotalPaid,
        paid_date: payForm.paid_date,
      });
      setPayRow(null);
      setPayListOwner(null);
      loadLedger();
    } catch (err: any) {
      setPayError(err.message);
    } finally {
      setPaySaving(false);
    }
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
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <Input
            placeholder="Search by name, phone, or CNIC…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <label className="flex items-center gap-2 text-sm text-ink/60 whitespace-nowrap">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        <DataTable
          keyField="id"
          rows={filtered}
          emptyMessage={search ? "No owners match that search." : "No owners yet."}
          columns={[
            { header: "Name", accessor: (o) => o.name },
            { header: "Phone", accessor: (o) => o.phone ?? "—" },
            { header: "CNIC", accessor: (o) => o.cnic ?? "—" },
            {
              header: "Balance due",
              accessor: (o) => {
                const { balance, status } = ownerBalanceStatus(o.id);
                if (status === null) return <span className="text-ink/40">—</span>;
                return (
                  <div className="flex items-center justify-end gap-2">
                    <span className={`figures font-medium ${balance > 0 ? "text-stamp-red" : ""}`}>
                      {formatPkr(balance)}
                    </span>
                    <StampBadge status={status} />
                  </div>
                );
              },
              align: "right",
            },
            {
              header: "",
              accessor: (o) => (
                <div className="flex gap-1 justify-end no-print">
                  {ownerBalanceStatus(o.id).balance > 0 && (
                    <button onClick={() => openPayList(o)} title="Pay owner" className="p-1.5 rounded hover:bg-ledger/5 text-ink/50 hover:text-ink">
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

      <Modal
        open={!!payListOwner}
        onClose={() => setPayListOwner(null)}
        title={payListOwner ? `Pay ${payListOwner.name}` : "Pay owner"}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            One row per building/month with an outstanding balance. Pick one to record a payout against it.
          </p>
          {payListOwner &&
            rowsForOwner(payListOwner.id)
              .filter((r) => Number(r.amount_payable) - Number(r.amount_paid || 0) > 0)
              .map((r) => {
                const balance = Number(r.amount_payable) - Number(r.amount_paid || 0);
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between border border-border rounded-card px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">{buildingName(r.building_id)}</p>
                      <p className="text-xs text-ink/50">{r.ledger_month}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="figures text-sm font-medium text-stamp-red">{formatPkr(balance)}</span>
                      <Button variant="secondary" onClick={() => openPayForm(r)}>
                        Pay
                      </Button>
                    </div>
                  </div>
                );
              })}
        </div>
      </Modal>

      <Modal open={!!payRow} onClose={() => setPayRow(null)} title="Record payout to owner">
        <form onSubmit={handlePay} className="space-y-4">
          {payRow && (
            <p className="text-xs text-ink/50 bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2">
              {buildingName(payRow.building_id)} — {payRow.ledger_month}
              {" · "}
              Already paid: <span className="figures font-medium">{formatPkr(payRow.amount_paid || 0)}</span>
              {" · "}
              Remaining:{" "}
              <span className="figures font-medium">
                {formatPkr(Number(payRow.amount_payable) - Number(payRow.amount_paid || 0))}
              </span>
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
            <Button type="button" variant="ghost" onClick={() => setPayRow(null)}>
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
