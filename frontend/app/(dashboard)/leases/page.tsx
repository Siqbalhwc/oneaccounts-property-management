"use client";

import { useEffect, useRef, useState, Fragment } from "react";
import Link from "next/link";
import { api, Lease, Tenant, Room, Building, SecurityDeposit, SecurityDepositPayment, Account, fetchPdfBlob } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { Field, Input, Select } from "@/components/ui/Field";
import { ChevronRight, ChevronDown, FileText, Pencil, Printer, Banknote, SlidersHorizontal } from "lucide-react";

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

type ChargeMapping = { label: string; account_id: string };

export default function LeasesPage() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [deposits, setDeposits] = useState<SecurityDeposit[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [chargeMappings, setChargeMappings] = useState<ChargeMapping[]>([]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [editForm, setEditForm] = useState({ start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // --- List view: expandable row + optional column visibility ---
  const [expandedLeaseId, setExpandedLeaseId] = useState<string | null>(null);
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const [showStartCol, setShowStartCol] = useState(true);
  const [showEndCol, setShowEndCol] = useState(true);
  const [showDepositCol, setShowDepositCol] = useState(true);
  const colsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (colsMenuRef.current && !colsMenuRef.current.contains(e.target as Node)) {
        setColsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- Charges (add / edit amount / end) ---
  const [activeCharges, setActiveCharges] = useState<LeaseCharge[] | null>(null);
  const [chargeHistory, setChargeHistory] = useState<LeaseCharge[] | null>(null);
  const [chargeImpactMessage, setChargeImpactMessage] = useState<string | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [chargeActionBusy, setChargeActionBusy] = useState(false);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [editingChargeMinDate, setEditingChargeMinDate] = useState<string>("");
  const [editChargeForm, setEditChargeForm] = useState({ new_amount: "", effective_from: new Date().toISOString().slice(0, 10), show_on_invoice: true });
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addChargeForm, setAddChargeForm] = useState({
    label: "",
    amount: "",
    recurrence: "recurring" as "recurring" | "one_time",
    effective_from: new Date().toISOString().slice(0, 10),
    show_on_invoice: true,
    account_id: "",
  });
  // Has the user manually picked a different account than what the label
  // auto-suggested? Once true, typing more of the label won't silently
  // overwrite their choice.
  const [addChargeAccountTouched, setAddChargeAccountTouched] = useState(false);

  function existingMappingFor(label: string): ChargeMapping | undefined {
    const trimmed = label.trim().toLowerCase();
    if (!trimmed) return undefined;
    return chargeMappings.find((m) => m.label.toLowerCase() === trimmed);
  }

  function handleAddChargeLabelChange(label: string) {
    const mapping = existingMappingFor(label);
    setAddChargeForm((prev) => ({
      ...prev,
      label,
      // Auto-fill from the known mapping as the label is typed, unless
      // the user already deliberately chose a different account for this
      // charge -- in which case leave their choice alone.
      account_id: addChargeAccountTouched ? prev.account_id : mapping?.account_id ?? "",
    }));
  }

  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receivingDeposit, setReceivingDeposit] = useState<SecurityDeposit | null>(null);
  const [depositPayments, setDepositPayments] = useState<SecurityDepositPayment[] | null>(null);
  const [receiveAmount, setReceiveAmount] = useState("");
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
    api.get<ChargeMapping[]>("/chart-of-accounts/charge-mappings").then(setChargeMappings);
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
    setDepositPayments(null);
    api.get<SecurityDepositPayment[]>(`/security-deposits/${deposit.id}/payments`).then(setDepositPayments);
    const pending = deposit.amount_pending ?? deposit.amount_received;
    setReceiveAmount(pending > 0 ? String(pending) : "");
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
    const amountBefore = Number(receivingDeposit.amount_paid ?? 0);
    const amountAttempted = parseFloat(receiveAmount);
    try {
      await api.post(`/security-deposits/${receivingDeposit.id}/payments`, {
        amount: amountAttempted,
        account_id: receiveAccountId,
        payment_date: receiveDate || undefined,
      });
      setReceiveModalOpen(false);
      loadDeposits();
    } catch (err: any) {
      // The write can succeed on the server even though the browser's
      // fetch reports "Failed to fetch" (e.g. a slow response after a
      // serverless cold start). Before showing an error -- which would
      // tempt a re-click and risk a genuine duplicate payment -- check
      // whether the payment actually landed.
      try {
        const fresh = await api.get<SecurityDeposit>(`/security-deposits/${receivingDeposit.id}`);
        const amountAfter = Number(fresh.amount_paid ?? 0);
        if (amountAfter >= amountBefore + amountAttempted - 0.01) {
          setReceiveModalOpen(false);
          loadDeposits();
          return;
        }
      } catch {
        // Recheck itself failed too -- fall through and show the original error.
      }
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
    setAddChargeAccountTouched(false);
    loadCharges(lease.id);
    setEditModalOpen(true);
  }

  async function handleAddCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLease) return;
    if (!addChargeForm.account_id) {
      setChargeError("Please choose which account this charge posts to.");
      return;
    }
    setChargeActionBusy(true);
    setChargeError(null);
    try {
      // Always confirm the mapping, whether it's brand new or just being
      // re-verified -- if the account shown was wrong (e.g. an old typo'd
      // label), this is also how it gets corrected, going forward, for
      // every future charge under this same label.
      await api.put("/chart-of-accounts/charge-mappings", { label: addChargeForm.label, account_id: addChargeForm.account_id });
      setChargeMappings((prev) => {
        const rest = prev.filter((m) => m.label.toLowerCase() !== addChargeForm.label.trim().toLowerCase());
        return [...rest, { label: addChargeForm.label, account_id: addChargeForm.account_id }];
      });

      const res = await api.post<{ impact_message: string }>(`/leases/${editingLease.id}/charges`, {
        label: addChargeForm.label,
        amount: parseFloat(addChargeForm.amount),
        recurrence: addChargeForm.recurrence,
        effective_from: addChargeForm.effective_from,
        show_on_invoice: addChargeForm.show_on_invoice,
      });
      setChargeImpactMessage(res.impact_message);
      setAddChargeOpen(false);
      setAddChargeAccountTouched(false);
      setAddChargeForm({ label: "", amount: "", recurrence: "recurring", effective_from: new Date().toISOString().slice(0, 10), show_on_invoice: true, account_id: "" });
      loadCharges(editingLease.id);
    } catch (err: any) {
      setChargeError(err.message);
    } finally {
      setChargeActionBusy(false);
    }
  }

  function openEditCharge(charge: LeaseCharge) {
    setEditingChargeId(charge.id);
    setEditingChargeMinDate(charge.effective_from);
    // Default to today, but never below the charge's own start date --
    // picking an earlier date than that is exactly what left this lease
    // with a charge row whose end date came before its start date.
    const todayIso = new Date().toISOString().slice(0, 10);
    setEditChargeForm({
      new_amount: String(charge.amount),
      effective_from: todayIso < charge.effective_from ? charge.effective_from : todayIso,
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

  async function handleRecalculate() {
    if (!editingLease) return;
    setChargeActionBusy(true);
    setChargeError(null);
    try {
      const res = await api.post<{ impact_message: string }>(`/leases/${editingLease.id}/resync-current-invoice`, {});
      setChargeImpactMessage(res.impact_message);
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
            One-year agreements linking a tenant to an apartment, with their rent
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
            placeholder="Search by tenant, building, or apartment…"
            className="max-w-xs"
          />
          <div className="relative" ref={colsMenuRef}>
            <button
              type="button"
              onClick={() => setColsMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-card border border-border text-ink hover:bg-ink/5"
            >
              <SlidersHorizontal size={14} />
              Columns
              <ChevronDown size={13} />
            </button>
            {colsMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-20 bg-paper-card border border-border rounded-card shadow-card p-2 min-w-[190px]">
                <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold px-2 pt-1 pb-1.5">
                  Optional columns
                </p>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showStartCol}
                    onChange={(e) => setShowStartCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  Start date
                </label>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showEndCol}
                    onChange={(e) => setShowEndCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  End date
                </label>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDepositCol}
                    onChange={(e) => setShowDepositCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  Security deposit
                </label>
              </div>
            )}
          </div>
        </div>

        {filteredLeases.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink/45 border border-dashed border-border rounded-card">
            No leases yet — create one to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-4 pb-2.5 pr-0.5"></th>
                  <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Tenant
                  </th>
                  <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Building / Apartment
                  </th>
                  {showStartCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      Start date
                    </th>
                  )}
                  {showEndCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      End date
                    </th>
                  )}
                  <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Status
                  </th>
                  {showDepositCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      Security deposit
                    </th>
                  )}
                  <th className="text-right text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 whitespace-nowrap no-print">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredLeases.map((l) => {
                  const deposit = depositForLease(l.id);
                  const hasDeposit = !!deposit && Number(deposit.amount_received) > 0;
                  const paid = hasDeposit
                    ? deposit!.amount_paid ?? (deposit!.is_received ? deposit!.amount_received : 0)
                    : 0;
                  const pending = hasDeposit
                    ? deposit!.amount_pending ?? Math.max(deposit!.amount_received - paid, 0)
                    : 0;
                  const fullyPaid = hasDeposit && pending <= 0.01;
                  const expanded = expandedLeaseId === l.id;
                  const colSpan =
                    5 + (showStartCol ? 1 : 0) + (showEndCol ? 1 : 0) + (showDepositCol ? 1 : 0);

                  return (
                    <Fragment key={l.id}>
                      <tr
                        onClick={() => setExpandedLeaseId(expanded ? null : l.id)}
                        className="border-b border-border/60 cursor-pointer hover:bg-accent/[0.03]"
                      >
                        <td className="py-3 pr-0.5 text-ink/40">
                          <ChevronRight
                            size={14}
                            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap font-medium">
                          {tenantName(l.tenant_id)}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">{roomAndBuilding(l.room_id)}</td>
                        {showStartCol && (
                          <td className="py-3 pr-4 whitespace-nowrap figures">{l.start_date}</td>
                        )}
                        {showEndCol && (
                          <td className="py-3 pr-4 whitespace-nowrap figures">{l.end_date}</td>
                        )}
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <StampBadge status={l.status} />
                        </td>
                        {showDepositCol && (
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {!hasDeposit ? (
                              <span className="text-xs text-ink/35">— none —</span>
                            ) : fullyPaid ? (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent/10 text-accent whitespace-nowrap">
                                Received
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brass/15 text-brass whitespace-nowrap">
                                {paid > 0 ? "Partial" : "Pending"}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="py-3 text-right no-print" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            <Link
                              href={`/leases/${l.id}/settlement`}
                              title="Settlement"
                              className={`p-1.5 rounded inline-flex ${
                                l.status !== "active"
                                  ? "opacity-30 pointer-events-none"
                                  : "hover:bg-accent/5 text-ink/50 hover:text-ink"
                              }`}
                            >
                              <FileText size={16} />
                            </Link>
                            <button
                              onClick={() => openEditModal(l)}
                              title="Edit lease"
                              className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink"
                            >
                              <Pencil size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-border/60 bg-accent/[0.02]">
                          <td colSpan={colSpan} className="px-0 py-0">
                            <div className="pl-9 pr-4 py-4">
                              {!hasDeposit ? (
                                <p className="text-xs text-ink/45">
                                  No security deposit on this lease.
                                </p>
                              ) : (
                                <div className="flex flex-wrap items-center gap-x-10 gap-y-2">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                      Deposit agreed
                                    </p>
                                    <p className="text-sm figures">
                                      Rs {Number(deposit!.amount_received).toLocaleString("en-PK")}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                      Received so far
                                    </p>
                                    <p className="text-sm figures">
                                      Rs {paid.toLocaleString("en-PK")}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                      Pending
                                    </p>
                                    <p
                                      className={`text-sm figures ${
                                        !fullyPaid ? "text-brass font-medium" : ""
                                      }`}
                                    >
                                      Rs {pending.toLocaleString("en-PK")}
                                    </p>
                                  </div>
                                  <div className="no-print">
                                    {fullyPaid ? (
                                      <Button
                                        variant="secondary"
                                        onClick={() => handlePrintReceipt(deposit!.id)}
                                        disabled={printingDepositId === deposit!.id}
                                      >
                                        <Printer size={14} className="mr-1.5 inline -mt-0.5" />
                                        {printingDepositId === deposit!.id ? "Opening…" : "Print receipt"}
                                      </Button>
                                    ) : (
                                      <Button variant="secondary" onClick={() => openReceiveModal(deposit!)}>
                                        <Banknote size={14} className="mr-1.5 inline -mt-0.5" />
                                        Record payment
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wider text-ink/45">Charges</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={handleRecalculate} disabled={chargeActionBusy}>
                  {chargeActionBusy ? "Recalculating…" : "Recalculate this month's invoice"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => { setAddChargeOpen((v) => !v); setAddChargeAccountTouched(false); }}>
                  {addChargeOpen ? "Cancel" : "+ Add charge"}
                </Button>
              </div>
            </div>

            {chargeImpactMessage && (
              <p className="text-xs bg-accent/5 border border-accent/15 rounded-card px-3 py-2 text-ink/70">
                {chargeImpactMessage}
              </p>
            )}
            {chargeError && <p className="text-sm text-stamp-red">{chargeError}</p>}

            {addChargeOpen && (
              <form onSubmit={handleAddCharge} className="space-y-3 bg-accent/5 border border-accent/15 rounded-card p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Label">
                    <Input
                      required
                      list="known-charge-labels"
                      placeholder="e.g. Parking"
                      value={addChargeForm.label}
                      onChange={(e) => handleAddChargeLabelChange(e.target.value)}
                    />
                    <datalist id="known-charge-labels">
                      {chargeMappings.map((m) => (
                        <option key={m.label} value={m.label} />
                      ))}
                    </datalist>
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
                <Field
                  label="GL account"
                  hint={
                    existingMappingFor(addChargeForm.label)
                      ? `"${addChargeForm.label}" already posts to this account — pick a different one below if that's wrong (e.g. a spelling mismatch from before). This updates it for every future charge under this label, on any lease.`
                      : addChargeForm.label.trim()
                      ? `"${addChargeForm.label}" hasn't been billed before — choose where it should post. Every future charge with this exact label will use the same account.`
                      : "Type a label above, or pick one from the list — matching labels reuse the same account automatically."
                  }
                >
                  <Select
                    required
                    value={addChargeForm.account_id}
                    onChange={(e) => {
                      setAddChargeAccountTouched(true);
                      setAddChargeForm({ ...addChargeForm, account_id: e.target.value });
                    }}
                  >
                    <option value="">Select an account…</option>
                    {accounts.filter((a) => a.account_type === "income").map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
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
                    className="space-y-2 bg-accent/5 border border-accent/15 rounded-card p-3"
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
                      <Field label="Effective from" hint={`Can't be before ${editingChargeMinDate} — that's when this charge started.`}>
                        <Input
                          type="date"
                          required
                          min={editingChargeMinDate}
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

      <Modal open={receiveModalOpen} onClose={() => setReceiveModalOpen(false)} title="Record security deposit payment">
        <form onSubmit={handleReceiveSubmit} className="space-y-4">
          {receivingDeposit && (
            <div className="text-xs text-ink/50 space-y-0.5">
              <p>{tenantName(leases?.find((l) => l.id === receivingDeposit.lease_id)?.tenant_id ?? "")}</p>
              <p>
                Agreed amount: <span className="figures">Rs {Number(receivingDeposit.amount_received).toLocaleString("en-PK")}</span>
                {" — "}
                Received so far: <span className="figures">Rs {Number(receivingDeposit.amount_paid ?? 0).toLocaleString("en-PK")}</span>
                {" — "}
                <span className="text-brass font-medium">
                  Pending: Rs {Number(receivingDeposit.amount_pending ?? receivingDeposit.amount_received).toLocaleString("en-PK")}
                </span>
              </p>
            </div>
          )}

          {depositPayments && depositPayments.length > 0 && (
            <div className="bg-accent/5 border border-accent/15 rounded-card p-3 space-y-1">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">Payments so far</p>
              {depositPayments.map((p) => (
                <div key={p.id} className="flex justify-between text-xs text-ink/70">
                  <span>{p.payment_date}</span>
                  <span className="figures">Rs {Number(p.amount).toLocaleString("en-PK")}</span>
                </div>
              ))}
            </div>
          )}

          <Field
            label="Amount"
            hint={
              receivingDeposit
                ? `This is a partial payment — enter any amount up to the Rs ${Number(receivingDeposit.amount_pending ?? receivingDeposit.amount_received).toLocaleString("en-PK")} still pending. Paying it in full at once works the same way.`
                : undefined
            }
          >
            <Input
              type="number"
              required
              max={receivingDeposit?.amount_pending ?? receivingDeposit?.amount_received}
              value={receiveAmount}
              onChange={(e) => setReceiveAmount(e.target.value)}
            />
          </Field>
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
            <Button type="submit" disabled={receiving || !receiveAccountId || !receiveAmount}>
              {receiving ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
