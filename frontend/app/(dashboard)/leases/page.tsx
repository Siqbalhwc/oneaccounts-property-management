"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Lease, Tenant, Room, Building, SecurityDeposit, Account, fetchPdfBlob } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { Field, Input, Select } from "@/components/ui/Field";

type LeaseCharge = {
  id: string;
  lease_id: string;
  label: string;
  amount: number;
  recurrence: "recurring" | "one_time";
  effective_from: string;
  effective_to?: string | null;
  show_on_invoice: boolean;
};

export default function LeasesPage() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [deposits, setDeposits] = useState<SecurityDeposit[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [editForm, setEditForm] = useState({ start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // --- Charges (add / edit amount / end) ---
  const [activeCharges, setActiveCharges] = useState<LeaseCharge[] | null>(null);
  const [chargeHistory, setChargeHistory] = useState<LeaseCharge[] | null>(null);
  const [chargeImpactMessage, setChargeImpactMessage] = useState<string | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [chargeActionBusy, setChargeActionBusy] = useState(false);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [editChargeForm, setEditChargeForm] = useState({ new_amount: "", effective_from: new Date().toISOString().slice(0, 10), show_on_invoice: true });
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addChargeForm, setAddChargeForm] = useState({
    label: "",
    amount: "",
    recurrence: "recurring" as "recurring" | "one_time",
    effective_from: new Date().toISOString().slice(0, 10),
    show_on_invoice: true,
  });

  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receivingDeposit, setReceivingDeposit] = useState<SecurityDeposit | null>(null);
  const [receiveAccountId, setReceiveAccountId] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [printingDepositId, setPrintingDepositId] = useState<string | null>(null);

  function loadDeposits() {
    api.get<SecurityDeposit[]>("/security-deposits").then(setDeposits);
  }

  function load() {
    api.get<Lease[]>("/leases").then(setLeases);
  }

  useEffect(() => {
    load();
    loadDeposits();
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
  }, []);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? "—";
  const roomAndBuilding = (roomId: string) => {
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };
  const depositForLease = (leaseId: string) => deposits?.find((d) => d.lease_id === leaseId) ?? null;

  function openReceiveModal(deposit: SecurityDeposit) {
    setReceivingDeposit(deposit);
    setReceiveAccountId("");
    setReceiveDate(new Date().toISOString().slice(0, 10));
    setReceiveError(null);
    setReceiveModalOpen(true);
  }

  async function handleReceiveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!receivingDeposit) return;
    setReceiving(true);
    setReceiveError(null);
    try {
      await api.post(`/security-deposits/${receivingDeposit.id}/receive`, {
        account_id: receiveAccountId,
        received_date: receiveDate || undefined,
      });
      setReceiveModalOpen(false);
      loadDeposits();
    } catch (err: any) {
      setReceiveError(err.message);
    } finally {
      setReceiving(false);
    }
  }

  async function handlePrintReceipt(depositId: string) {
    setPrintingDepositId(depositId);
    try {
      const blob = await fetchPdfBlob(`/security-deposits/${depositId}/receipt-pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } finally {
      setPrintingDepositId(null);
    }
  }

  function loadCharges(leaseId: string) {
    api.get<LeaseCharge[]>(`/leases/${leaseId}/charges`).then(setActiveCharges);
    api.get<LeaseCharge[]>(`/leases/${leaseId}/charges/history`).then(setChargeHistory);
  }

  function openEditModal(lease: Lease) {
    setEditingLease(lease);
    setEditForm({ start_date: lease.start_date, end_date: lease.end_date });
    setError(null);
    setChargeError(null);
    setChargeImpactMessage(null);
    setEditingChargeId(null);
    setAddChargeOpen(false);
    loadCharges(lease.id);
    setEditModalOpen(true);
  }

  async function handleAddCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLease) return;
    setChargeActionBusy(true);
    setChargeError(null);
    try {
      const res = await api.post<{ impact_message: string }>(`/leases/${editingLease.id}/charges`, {
        label: addChargeForm.label,
        amount: parseFloat(addChargeForm.amount),
        recurrence: addChargeForm.recurrence,
        effective_from: addChargeForm.effective_from,
        show_on_invoice: addChargeForm.show_on_invoice,
      });
      setChargeImpactMessage(res.impact_message);
      setAddChargeOpen(false);
      setAddChargeForm({ label: "", amount: "", recurrence: "recurring", effective_from: new Date().toISOString().slice(0, 10), show_on_invoice: true });
      loadCharges(editingLease.id);
    } catch (err: any) {
      setChargeError(err.message);
    } finally {
      setChargeActionBusy(false);
    }
  }

  function openEditCharge(charge: LeaseCharge) {
    setEditingChargeId(charge.id);
    setEditChargeForm({
      new_amount: String(charge.amount),
      effective_from: new Date().toISOString().slice(0, 10),
      show_on_invoice: charge.show_on_invoice,
    });
    setChargeError(null);
  }

  async function handleSaveChargeAmount(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLease || !editingChargeId) return;
    setChargeActionBusy(true);
    setChargeError(null);
    try {
      const res = await api.patch<{ impact_message: string }>(`/leases/${editingLease.id}/charges/${editingChargeId}`, {
        new_amount: parseFloat(editChargeForm.new_amount),
        effective_from: editChargeForm.effective_from,
        show_on_invoice: editChargeForm.show_on_invoice,
      });
      setChargeImpactMessage(res.impact_message);
      setEditingChargeId(null);
      loadCharges(editingLease.id);
    } catch (err: any) {
      setChargeError(err.message);
    } finally {
      setChargeActionBusy(false);
    }
  }

  const [chargeToEnd, setChargeToEnd] = useState<LeaseCharge | null>(null);

  function askEndCharge(charge: LeaseCharge) {
    setChargeToEnd(charge);
  }

  async function confirmEndCharge() {
    if (!editingLease || !chargeToEnd) return;
    setChargeActionBusy(true);
    setChargeError(null);
    try {
      const res = await api.post<{ impact_message: string }>(`/leases/${editingLease.id}/charges/${chargeToEnd.id}/end`, {});
      setChargeImpactMessage(res.impact_message);
      setChargeToEnd(null);
      loadCharges(editingLease.id);
    } catch (err: any) {
      setChargeError(err.message);
    } finally {
      setChargeActionBusy(false);
    }
  }

  const filteredLeases = (leases ?? []).filter((l) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      tenantName(l.tenant_id).toLowerCase().includes(q) ||
      roomAndBuilding(l.room_id).toLowerCase().includes(q)
    );
  });

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
        <div className="flex items-center justify-between mb-4 no-print gap-3 flex-wrap">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by tenant, building, or room…"
            className="max-w-xs"
          />
        </div>
        <DataTable
          keyField="id"
          rows={filteredLeases}
          emptyMessage="No leases yet — create one to get started."
          columns={[
            { header: "Tenant", accessor: (l) => <span className="font-medium">{tenantName(l.tenant_id)}</span> },
            { header: "Building / Room", accessor: (l) => roomAndBuilding(l.room_id) },
            { header: "Start date", accessor: (l) => l.start_date },
            { header: "End date", accessor: (l) => l.end_date },
            { header: "Status", accessor: (l) => <StampBadge status={l.status} /> },
            {
              header: "Security deposit",
              accessor: (l) => {
                const deposit = depositForLease(l.id);
                if (!deposit || Number(deposit.amount_received) <= 0) return "—";
                return (
                  <div className="flex items-center gap-2">
                    <span className="figures text-sm">Rs {Number(deposit.amount_received).toLocaleString("en-PK")}</span>
                    {deposit.is_received ? (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-ledger/10 text-ledger">
                          Received
                        </span>
                        <Button
                          variant="ghost"
                          className="no-print"
                          onClick={() => handlePrintReceipt(deposit.id)}
                          disabled={printingDepositId === deposit.id}
                        >
                          {printingDepositId === deposit.id ? "Opening…" : "Print receipt"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brass/15 text-brass">
                          Pending
                        </span>
                        <Button variant="secondary" className="no-print" onClick={() => openReceiveModal(deposit)}>
                          Record receipt
                        </Button>
                      </>
                    )}
                  </div>
                );
              },
            },
            {
              header: "",
              accessor: (l) => (
                <Button variant="ghost" onClick={() => openEditModal(l)} className="no-print">
                  Edit lease
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit lease" size="full">
        <div className="space-y-6">
          <p className="text-xs text-ink/50">
            {editingLease && tenantName(editingLease.tenant_id)} — {editingLease && roomAndBuilding(editingLease.room_id)}
          </p>

          {/* --- Dates --- */}
          <form onSubmit={handleSave} className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-ink/45">Dates</p>
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
            <p className="text-xs text-ink/40">
              Any date is fine, including shortening a lease down to a single month — there&apos;s no minimum term.
            </p>
            {error && <p className="text-sm text-stamp-red">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save dates"}
              </Button>
            </div>
          </form>

          {/* --- Charges --- */}
          <div className="pt-4 border-t border-border space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-ink/45">Charges</p>
              <Button type="button" variant="secondary" onClick={() => setAddChargeOpen((v) => !v)}>
                {addChargeOpen ? "Cancel" : "+ Add charge"}
              </Button>
            </div>

            {chargeImpactMessage && (
              <p className="text-xs bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2 text-ink/70">
                {chargeImpactMessage}
              </p>
            )}
            {chargeError && <p className="text-sm text-stamp-red">{chargeError}</p>}

            {addChargeOpen && (
              <form onSubmit={handleAddCharge} className="space-y-3 bg-ledger/5 border border-ledger/15 rounded-card p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Label">
                    <Input
                      required
                      placeholder="e.g. Parking"
                      value={addChargeForm.label}
                      onChange={(e) => setAddChargeForm({ ...addChargeForm, label: e.target.value })}
                    />
                  </Field>
                  <Field label="Amount">
                    <Input
                      type="number"
                      required
                      value={addChargeForm.amount}
                      onChange={(e) => setAddChargeForm({ ...addChargeForm, amount: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Recurrence">
                    <Select
                      value={addChargeForm.recurrence}
                      onChange={(e) => setAddChargeForm({ ...addChargeForm, recurrence: e.target.value as "recurring" | "one_time" })}
                    >
                      <option value="recurring">Recurring (every invoice)</option>
                      <option value="one_time">One-time (this invoice only)</option>
                    </Select>
                  </Field>
                  <Field label="Starts from">
                    <Input
                      type="date"
                      required
                      value={addChargeForm.effective_from}
                      onChange={(e) => setAddChargeForm({ ...addChargeForm, effective_from: e.target.value })}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink/60">
                  <input
                    type="checkbox"
                    checked={addChargeForm.show_on_invoice}
                    onChange={(e) => setAddChargeForm({ ...addChargeForm, show_on_invoice: e.target.checked })}
                  />
                  Print this line on the invoice PDF
                </label>
                <div className="flex justify-end">
                  <Button type="submit" disabled={chargeActionBusy}>
                    {chargeActionBusy ? "Adding…" : "Add charge"}
                  </Button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              {activeCharges === null && <p className="text-xs text-ink/40">Loading charges…</p>}
              {activeCharges?.length === 0 && <p className="text-xs text-ink/40">No active charges.</p>}
              {activeCharges?.map((c) =>
                editingChargeId === c.id ? (
                  <form
                    key={c.id}
                    onSubmit={handleSaveChargeAmount}
                    className="space-y-2 bg-ledger/5 border border-ledger/15 rounded-card p-3"
                  >
                    <p className="text-sm font-medium">{c.label}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="New amount">
                        <Input
                          type="number"
                          required
                          value={editChargeForm.new_amount}
                          onChange={(e) => setEditChargeForm({ ...editChargeForm, new_amount: e.target.value })}
                        />
                      </Field>
                      <Field label="Effective from">
                        <Input
                          type="date"
                          required
                          value={editChargeForm.effective_from}
                          onChange={(e) => setEditChargeForm({ ...editChargeForm, effective_from: e.target.value })}
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ink/60">
                      <input
                        type="checkbox"
                        checked={editChargeForm.show_on_invoice}
                        onChange={(e) => setEditChargeForm({ ...editChargeForm, show_on_invoice: e.target.checked })}
                      />
                      Print this line on the invoice PDF
                    </label>
                    <p className="text-xs text-ink/40">
                      The old amount stays on every invoice already generated — this only changes what&apos;s billed from {editChargeForm.effective_from || "today"} onward.
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setEditingChargeId(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={chargeActionBusy}>
                        {chargeActionBusy ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div key={c.id} className="flex items-center justify-between bg-paper border border-border rounded-card px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {c.label}
                        {!c.show_on_invoice && <span className="ml-2 text-xs text-ink/40">(hidden on PDF)</span>}
                        {c.recurrence === "one_time" && <span className="ml-2 text-xs text-ink/40">(one-time)</span>}
                      </p>
                      <p className="text-xs text-ink/50 figures">Rs {Number(c.amount).toLocaleString("en-PK")} · since {c.effective_from}</p>
                    </div>
                    <div className="flex gap-2 no-print">
                      <Button type="button" variant="ghost" onClick={() => openEditCharge(c)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => askEndCharge(c)} disabled={chargeActionBusy}>
                        End
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>

            {chargeHistory && chargeHistory.length > (activeCharges?.length ?? 0) && (
              <details className="text-xs text-ink/50">
                <summary className="cursor-pointer select-none">Full charge history (including ended charges)</summary>
                <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto scrollbar-thin">
                  {chargeHistory.map((c) => (
                    <div key={c.id} className="border-l-2 border-border pl-2">
                      {c.label} — Rs {Number(c.amount).toLocaleString("en-PK")} — {c.effective_from} to {c.effective_to ?? "present"}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {editingLease && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">Lease record history</p>
              <HistoryPanel tableName="leases" recordId={editingLease.id} />
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={() => setEditModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!chargeToEnd} onClose={() => setChargeToEnd(null)} title="End this charge?">
        <div className="space-y-4">
          <p className="text-sm text-ink/70">
            End <span className="font-medium">&quot;{chargeToEnd?.label}&quot;</span> today? It will no longer
            appear on future invoices, but every invoice that already billed it stays exactly as it was.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setChargeToEnd(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmEndCharge} disabled={chargeActionBusy}>
              {chargeActionBusy ? "Ending…" : "End charge"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={receiveModalOpen} onClose={() => setReceiveModalOpen(false)} title="Record security deposit receipt">
        <form onSubmit={handleReceiveSubmit} className="space-y-4">
          {receivingDeposit && (
            <p className="text-xs text-ink/50">
              Rs {Number(receivingDeposit.amount_received).toLocaleString("en-PK")} —{" "}
              {tenantName(leases?.find((l) => l.id === receivingDeposit.lease_id)?.tenant_id ?? "")}
            </p>
          )}
          <Field label="Received into which account?">
            <Select required value={receiveAccountId} onChange={(e) => setReceiveAccountId(e.target.value)}>
              <option value="">Select account…</option>
              {accounts
                .filter((a) => a.account_type === "asset")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Date received">
            <Input type="date" required value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
          </Field>
          {receiveError && <p className="text-sm text-stamp-red">{receiveError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setReceiveModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={receiving || !receiveAccountId}>
              {receiving ? "Saving…" : "Record receipt"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
