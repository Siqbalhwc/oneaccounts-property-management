"use client";

import { useEffect, useRef, useState, Fragment } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { api, Building, Account } from "@/lib/api";
import { ChevronRight, ChevronDown, Pencil, ScrollText, SplitSquareHorizontal, SlidersHorizontal } from "lucide-react";

type ExpenseCategory = { id: string; name: string; account_id?: string };
// Augmented locally since lib/api.ts's Room/Building types don't declare
// owner_id -- safe either way, since a plain Room/Building is still
// assignable to these (same pattern buildings/page.tsx already uses).
type RoomWithOwner = { id: string; building_id: string; room_number: string; owner_id?: string | null };
type BuildingWithOwner = Building & { owner_id?: string | null };
type OwnerRecord = { id: string; name: string };
type Expense = {
  id: string;
  category_id: string;
  building_id?: string;
  room_id?: string;
  amount: number;
  expense_date: string;
  description?: string;
  vendor_name?: string;
  recurrence?: "one_time" | "monthly";
  paid_from_account_id?: string;
};
type Allocation = { id?: string; building_id: string; allocation_type: "percentage" | "fixed"; value: string };
type AllocationSummaryRow = { source_id: string; building_id: string; allocation_type: string; value: number };
type JournalLine = { id: string; account_id: string; direction: "debit" | "credit"; amount: number; building_id?: string };

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [buildings, setBuildings] = useState<BuildingWithOwner[] | null>(null);
  const [rooms, setRooms] = useState<RoomWithOwner[] | null>(null);
  const [owners, setOwners] = useState<OwnerRecord[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [allocationsSummary, setAllocationsSummary] = useState<AllocationSummaryRow[]>([]);

  // --- List view: expandable row + optional column visibility ---
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const [showGlCol, setShowGlCol] = useState(true);
  const [showPaidFromCol, setShowPaidFromCol] = useState(true);
  const [showRecursCol, setShowRecursCol] = useState(true);
  const [showBuildingCol, setShowBuildingCol] = useState(true);
  const colsMenuRef = useRef<HTMLDivElement>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    category_id: "",
    building_id: "",
    room_id: "",
    vendor_name: "",
    amount: "",
    expense_date: new Date().toISOString().slice(0, 10),
    description: "",
    recurrence: "one_time" as "one_time" | "monthly",
    paid_from_account_id: "",
  });

  // --- Allocation split (for company-wide/shared expenses) ---
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [allocationTarget, setAllocationTarget] = useState<Expense | null>(null);
  const [allocationRows, setAllocationRows] = useState<Allocation[]>([]);
  const [allocationSaving, setAllocationSaving] = useState(false);
  const [allocationError, setAllocationError] = useState<string | null>(null);

  // --- View ledger (read-only journal entry drill-down) ---
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [ledgerTarget, setLedgerTarget] = useState<Expense | null>(null);
  const [ledgerLines, setLedgerLines] = useState<JournalLine[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateMonth, setGenerateMonth] = useState(new Date().toISOString().slice(0, 10));
  const [generateSaving, setGenerateSaving] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<{ created: string[]; skipped_already_generated: string[] } | null>(null);

  function load() {
    api.get<Expense[]>("/expenses").then(setExpenses);
    api.get<AllocationSummaryRow[]>("/expenses/allocations/summary").then(setAllocationsSummary);
  }

  useEffect(() => {
    load();
    api.get<ExpenseCategory[]>("/expense_categories").then((cats) => {
      setCategories(cats);
      setForm((f) => (f.category_id ? f : { ...f, category_id: cats[0]?.id ?? "" }));
    });
    api.get<BuildingWithOwner[]>("/buildings").then(setBuildings);
    api.get<RoomWithOwner[]>("/rooms").then(setRooms);
    api.get<OwnerRecord[]>("/owners?include_archived=true").then(setOwners);
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
  }, []);

  // Whether picking this category charges the expense straight to an
  // owner's balance (Due to Owners) instead of a normal company expense --
  // mirrors the backend's own check in expenses.py's _resolve_expense_account.
  function isOwnerChargeable(categoryId: string): boolean {
    const cat = categories?.find((c) => c.id === categoryId);
    if (!cat?.account_id) return false;
    return !!accounts?.find((a) => a.id === cat.account_id)?.transfers_to_owner;
  }

  // A room's own owner if set, else its building's default -- same rule
  // the backend's resolve_room_owner() uses, just for display here.
  function resolveRoomOwnerName(roomId: string): string {
    const room = rooms?.find((r) => r.id === roomId);
    if (!room) return "—";
    const ownerId = room.owner_id || buildings?.find((b) => b.id === room.building_id)?.owner_id;
    return owners?.find((o) => o.id === ownerId)?.name ?? "No owner set on this room or building";
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (colsMenuRef.current && !colsMenuRef.current.contains(e.target as Node)) {
        setColsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function openAddModal() {
    setEditingId(null);
    setError(null);
    setForm({
      category_id: categories?.[0]?.id ?? "",
      building_id: "",
      room_id: "",
      vendor_name: "",
      amount: "",
      expense_date: new Date().toISOString().slice(0, 10),
      description: "",
      recurrence: "one_time",
      paid_from_account_id: accounts?.find((a) => a.code === "1000")?.id ?? "",
    });
    setModalOpen(true);
  }

  function openEditModal(expense: Expense) {
    setEditingId(expense.id);
    setError(null);
    setForm({
      category_id: expense.category_id,
      building_id: expense.building_id ?? "",
      room_id: expense.room_id ?? "",
      vendor_name: expense.vendor_name ?? "",
      amount: String(expense.amount),
      expense_date: expense.expense_date,
      description: expense.description ?? "",
      recurrence: expense.recurrence ?? "one_time",
      paid_from_account_id: expense.paid_from_account_id ?? "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        // Amount, category, and building are locked once the expense has
        // posted to the ledger -- only these three can still be edited.
        await api.patch(`/expenses/${editingId}`, {
          vendor_name: form.vendor_name || undefined,
          expense_date: form.expense_date,
          description: form.description || undefined,
        });
      } else {
        if (!form.paid_from_account_id) {
          setError("Please select which account this was paid from.");
          setSaving(false);
          return;
        }
        const ownerCharged = isOwnerChargeable(form.category_id);
        if (ownerCharged && !form.room_id) {
          setError("This category is charged to an owner — select the room so the correct owner can be found.");
          setSaving(false);
          return;
        }
        await api.post("/expenses", {
          category_id: form.category_id,
          // building_id is only sent for a normal expense -- for an
          // owner-chargeable one the backend derives it FROM the room, so
          // there's never a second, independently-set value to drift out
          // of sync with the room actually picked.
          building_id: ownerCharged ? undefined : form.building_id || undefined,
          room_id: ownerCharged ? form.room_id : undefined,
          vendor_name: form.vendor_name || undefined,
          amount: parseFloat(form.amount),
          expense_date: form.expense_date,
          description: form.description || undefined,
          recurrence: form.recurrence,
          paid_from_account_id: form.paid_from_account_id,
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

  const categoryName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "—";
  const buildingName = (id: string) => buildings?.find((b) => b.id === id)?.name ?? "—";
  const accountLabel = (categoryId: string) => {
    const cat = categories?.find((c) => c.id === categoryId);
    const acct = accounts?.find((a) => a.id === cat?.account_id);
    return acct ? `${acct.code} · ${acct.name}` : "—";
  };
  const splitSummary = (expenseId: string) => {
    const rows = allocationsSummary.filter((r) => r.source_id === expenseId);
    if (rows.length === 0) return null;
    const expenseAmount = expenses?.find((e) => e.id === expenseId)?.amount ?? 0;
    return rows
      .map((r) => {
        // Show the actual rupee amount landing on each building, not just
        // the raw percentage/fixed value used to calculate it -- e.g. "20%"
        // on its own doesn't confirm Rs 1,000 is really what each building
        // gets out of a Rs 5,000 expense split five ways.
        const rupees = r.allocation_type === "percentage" ? (expenseAmount * r.value) / 100 : r.value;
        return `${buildingName(r.building_id)}: ${formatPkr(rupees)}`;
      })
      .join(", ");
  };

  async function openLedgerModal(expense: Expense) {
    setLedgerTarget(expense);
    setLedgerError(null);
    setLedgerLines(null);
    setLedgerModalOpen(true);
    try {
      const result = await api.get<{ entries: any[]; lines: JournalLine[] }>(
        `/ledger/entries?source_type=expense&source_id=${expense.id}`
      );
      setLedgerLines(result.lines);
    } catch (err: any) {
      setLedgerError(err.message);
    }
  }

  async function openAllocationModal(expense: Expense) {
    setAllocationTarget(expense);
    setAllocationError(null);
    setAllocationModalOpen(true);
    try {
      const existing = await api.get<Allocation[]>(`/expenses/${expense.id}/allocations`);
      setAllocationRows(
        existing.length > 0
          ? existing.map((a) => ({ ...a, value: String(a.value) }))
          : [{ building_id: buildings?.[0]?.id ?? "", allocation_type: "percentage", value: "" }]
      );
    } catch (err: any) {
      setAllocationError(err.message);
    }
  }

  function addAllocationRow() {
    setAllocationRows((rows) => [
      ...rows,
      { building_id: buildings?.[0]?.id ?? "", allocation_type: "percentage", value: "" },
    ]);
  }

  function removeAllocationRow(index: number) {
    setAllocationRows((rows) => rows.filter((_, i) => i !== index));
  }

  function updateAllocationRow(index: number, patch: Partial<Allocation>) {
    setAllocationRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleSaveAllocations(e: React.FormEvent) {
    e.preventDefault();
    if (!allocationTarget) return;

    const filled = allocationRows.filter((r) => r.building_id && r.value);
    const percentageRows = filled.filter((r) => r.allocation_type === "percentage");
    if (percentageRows.length > 0 && percentageRows.length === filled.length) {
      const total = percentageRows.reduce((sum, r) => sum + (parseFloat(r.value) || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        setAllocationError(`Percentages must add up to 100% — currently ${total}%.`);
        return;
      }
    }

    setAllocationSaving(true);
    setAllocationError(null);
    try {
      await api.put(`/expenses/${allocationTarget.id}/allocations`, {
        allocations: filled.map((r) => ({
          building_id: r.building_id,
          allocation_type: r.allocation_type,
          value: parseFloat(r.value),
        })),
      });
      setAllocationModalOpen(false);
      load();
    } catch (err: any) {
      setAllocationError(err.message);
    } finally {
      setAllocationSaving(false);
    }
  }

  async function handleGenerateRecurring(e: React.FormEvent) {
    e.preventDefault();
    setGenerateSaving(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const result = await api.post<{ created: string[]; skipped_already_generated: string[] }>(
        "/expenses/generate-recurring",
        { month: generateMonth }
      );
      setGenerateResult(result);
      load();
    } catch (err: any) {
      setGenerateError(err.message);
    } finally {
      setGenerateSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Expenses</h1>
          <p className="text-sm text-ink/55 mt-1">
            Actual bills paid — water, electricity, repairs — set against what
            was collected from tenants for the same thing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setGenerateError(null); setGenerateResult(null); setGenerateModalOpen(true); }}>
            Generate recurring
          </Button>
          <Button onClick={openAddModal}>Log expense</Button>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-end mb-4 no-print">
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
                    checked={showGlCol}
                    onChange={(e) => setShowGlCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  GL account
                </label>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPaidFromCol}
                    onChange={(e) => setShowPaidFromCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  Paid from
                </label>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRecursCol}
                    onChange={(e) => setShowRecursCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  Recurs
                </label>
                <label className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBuildingCol}
                    onChange={(e) => setShowBuildingCol(e.target.checked)}
                    className="accent-ledger"
                  />
                  Building / Split
                </label>
              </div>
            )}
          </div>
        </div>

        {(expenses ?? []).length === 0 ? (
          <div className="py-12 text-center text-sm text-ink/45 border border-dashed border-border rounded-card">
            No expenses logged yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-4 pb-2.5 pr-0.5"></th>
                  <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Category
                  </th>
                  <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Vendor
                  </th>
                  {showRecursCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      Recurs
                    </th>
                  )}
                  {showBuildingCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      Building / Split
                    </th>
                  )}
                  {showGlCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      GL account
                    </th>
                  )}
                  {showPaidFromCol && (
                    <th className="text-left text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                      Paid from
                    </th>
                  )}
                  <th className="text-right text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 whitespace-nowrap">
                    Amount
                  </th>
                  <th className="text-right text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 whitespace-nowrap no-print">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {(expenses ?? []).map((e) => {
                  const expanded = expandedExpenseId === e.id;
                  const colSpan =
                    6 + (showRecursCol ? 1 : 0) + (showBuildingCol ? 1 : 0) + (showGlCol ? 1 : 0) + (showPaidFromCol ? 1 : 0);
                  const paidFromAcct = accounts?.find((a) => a.id === e.paid_from_account_id);

                  return (
                    <Fragment key={e.id}>
                      <tr
                        onClick={() => setExpandedExpenseId(expanded ? null : e.id)}
                        className="border-b border-border/60 cursor-pointer hover:bg-accent/[0.03]"
                      >
                        <td className="py-3 pr-0.5 text-ink/40">
                          <ChevronRight
                            size={14}
                            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap figures">{e.expense_date}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{categoryName(e.category_id)}</td>
                        <td className="py-3 pr-4 whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis">
                          {e.vendor_name ?? "—"}
                        </td>
                        {showRecursCol && (
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {e.recurrence === "monthly" ? (
                              <span className="text-xs text-brass-dark font-medium">Monthly</span>
                            ) : (
                              <span className="text-xs text-ink/40">One-time</span>
                            )}
                          </td>
                        )}
                        {showBuildingCol && (
                          <td className="py-3 pr-4 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                            {e.room_id ? (
                              <span className="text-xs text-ink/60">
                                {buildingName(e.building_id ?? "")} — {rooms?.find((r) => r.id === e.room_id)?.room_number ?? "—"}
                              </span>
                            ) : e.building_id ? (
                              <span className="text-xs text-ink/60">{buildingName(e.building_id)}</span>
                            ) : splitSummary(e.id) ? (
                              <span className="text-xs text-ink/60">{splitSummary(e.id)}</span>
                            ) : (
                              <span className="text-xs text-stamp-red">Not split yet</span>
                            )}
                          </td>
                        )}
                        {showGlCol && (
                          <td className="py-3 pr-4 whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis">
                            <span className="text-xs text-ink/50">{accountLabel(e.category_id)}</span>
                          </td>
                        )}
                        {showPaidFromCol && (
                          <td className="py-3 pr-4 whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis">
                            <span className="text-xs text-ink/50">
                              {paidFromAcct ? `${paidFromAcct.code} · ${paidFromAcct.name}` : "—"}
                            </span>
                          </td>
                        )}
                        <td className="py-3 pr-4 text-right whitespace-nowrap figures">{formatPkr(e.amount)}</td>
                        <td className="py-3 text-right no-print" onClick={(ev) => ev.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => openEditModal(e)}
                              title="Edit"
                              className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink"
                            >
                              <Pencil size={16} />
                            </button>
                            {!e.building_id && (
                              <button
                                onClick={() => openAllocationModal(e)}
                                title="Manage split"
                                className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink"
                              >
                                <SplitSquareHorizontal size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => openLedgerModal(e)}
                              title="View ledger"
                              className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink"
                            >
                              <ScrollText size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-border/60 bg-accent/[0.02]">
                          <td colSpan={colSpan} className="px-0 py-0">
                            <div className="pl-9 pr-4 py-4">
                              <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                    GL account
                                  </p>
                                  <p className="text-xs text-ink/70">{accountLabel(e.category_id)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                    Paid from
                                  </p>
                                  <p className="text-xs text-ink/70">
                                    {paidFromAcct ? `${paidFromAcct.code} · ${paidFromAcct.name}` : "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                    Building / Split
                                  </p>
                                  <p className="text-xs text-ink/70">
                                    {e.building_id
                                      ? buildingName(e.building_id)
                                      : splitSummary(e.id) ?? "Company-wide, not split yet"}
                                  </p>
                                </div>
                                {e.description && (
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold mb-1">
                                      Description
                                    </p>
                                    <p className="text-xs text-ink/70">{e.description}</p>
                                  </div>
                                )}
                              </div>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit expense" : "Log expense"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingId && (
            <p className="text-xs text-ink/50 bg-accent/5 border border-accent/15 rounded-card px-3 py-2">
              Logging an expense records a bill your company has already paid —
              the date you enter is the date it was paid.
            </p>
          )}
          {editingId && (
            <p className="text-xs text-ink/50 bg-accent/5 border border-accent/15 rounded-card px-3 py-2">
              Category, building, amount, and paid-from account are locked
              once an expense is logged, since they&apos;ve already posted to
              the ledger. Delete and re-log the expense if any of those need
              to change.
            </p>
          )}
          <Field label="Category">
            <Select
              value={form.category_id}
              disabled={!!editingId}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {isOwnerChargeable(form.category_id) ? (
            <>
              <Field label="Room" hint="Required for an owner-chargeable category, so the correct owner can be found.">
                <Select
                  value={form.room_id}
                  disabled={!!editingId}
                  onChange={(e) => setForm({ ...form, room_id: e.target.value })}
                >
                  <option value="">Select a room…</option>
                  {rooms?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {buildings?.find((b) => b.id === r.building_id)?.name ?? "—"} — {r.room_number}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.room_id && (
                <div className="rounded-card border border-border bg-paper-card/60 px-3 py-2.5 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-ink/50">Building</span>
                    <span className="font-medium">
                      {buildings?.find((b) => b.id === rooms?.find((r) => r.id === form.room_id)?.building_id)?.name ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/50">Owner</span>
                    <span className="font-medium">{resolveRoomOwnerName(form.room_id)}</span>
                  </div>
                  <p className="text-xs text-ink/45 pt-1">
                    Derived from the room — not editable here. This expense will reduce what&apos;s owed to this owner instead of posting as a company expense.
                  </p>
                </div>
              )}
            </>
          ) : (
            <Field label="Building (optional)" hint={editingId ? undefined : "Leave blank for a company-wide expense you can split across buildings below."}>
              <Select
                value={form.building_id}
                disabled={!!editingId}
                onChange={(e) => setForm({ ...form, building_id: e.target.value })}
              >
                <option value="">Company-wide</option>
                {buildings?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!editingId && (
            <Field label="Recurrence" hint="Monthly expenses act as a template — use 'Generate recurring' each month to create that month's instance.">
              <Select
                value={form.recurrence}
                onChange={(e) => setForm({ ...form, recurrence: e.target.value as "one_time" | "monthly" })}
              >
                <option value="one_time">One-time</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>
          )}
          <Field label="Vendor (optional)">
            <Input
              value={form.vendor_name}
              onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
              placeholder="e.g. WASA, LESCO, Al-Noor Plumbing"
            />
          </Field>
          <Field label="Amount">
            <AmountInput
              required
              disabled={!!editingId}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Paid from" hint="Which account this actually came out of.">
            <Select
              value={form.paid_from_account_id}
              disabled={!!editingId}
              onChange={(e) => setForm({ ...form, paid_from_account_id: e.target.value })}
            >
              <option value="">Select an account…</option>
              {accounts?.filter((a) => a.account_type === "asset").map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date paid">
            <Input
              type="date"
              required
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Log expense"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={allocationModalOpen}
        onClose={() => setAllocationModalOpen(false)}
        title="Split across buildings"
      >
        <form onSubmit={handleSaveAllocations} className="space-y-4">
          <p className="text-xs text-ink/50">
            How this company-wide expense is divided up when computing each
            building&apos;s owner ledger — e.g. a shared generator bill split
            60/40 between two buildings.
          </p>
          {allocationRows.map((row, i) => (
            <div key={i} className="flex gap-2 items-end">
              <Field label="Building">
                <Select
                  value={row.building_id}
                  onChange={(e) => updateAllocationRow(i, { building_id: e.target.value })}
                >
                  {buildings?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select
                  value={row.allocation_type}
                  onChange={(e) => updateAllocationRow(i, { allocation_type: e.target.value as "percentage" | "fixed" })}
                >
                  <option value="percentage">%</option>
                  <option value="fixed">Fixed Rs</option>
                </Select>
              </Field>
              <Field label="Value">
                <Input
                  type="number"
                  value={row.value}
                  onChange={(e) => updateAllocationRow(i, { value: e.target.value })}
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => removeAllocationRow(i)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={addAllocationRow}>
            + Add building
          </Button>
          {allocationError && <p className="text-sm text-stamp-red">{allocationError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAllocationModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={allocationSaving}>
              {allocationSaving ? "Saving…" : "Save split"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={generateModalOpen} onClose={() => setGenerateModalOpen(false)} title="Generate recurring expenses">
        <form onSubmit={handleGenerateRecurring} className="space-y-4">
          <p className="text-xs text-ink/50">
            Creates this month&apos;s instance of every expense marked
            &quot;Monthly&quot; that hasn&apos;t already been generated for
            this month.
          </p>
          <Field label="Month" hint="Any date within the month works.">
            <Input type="date" value={generateMonth} onChange={(e) => setGenerateMonth(e.target.value)} />
          </Field>
          {generateError && <p className="text-sm text-stamp-red">{generateError}</p>}
          {generateResult && (
            <p className="text-xs text-stamp-green">
              Created {generateResult.created.length}, skipped {generateResult.skipped_already_generated.length} (already generated).
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setGenerateModalOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={generateSaving}>
              {generateSaving ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={ledgerModalOpen}
        onClose={() => setLedgerModalOpen(false)}
        title={ledgerTarget ? `Ledger — ${categoryName(ledgerTarget.category_id)}, ${formatPkr(ledgerTarget.amount)}` : "Ledger"}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            Exactly what this expense posted to the double-entry ledger — read-only.
          </p>
          {ledgerError && <p className="text-sm text-stamp-red">{ledgerError}</p>}
          {!ledgerError && ledgerLines === null && <p className="text-sm text-ink/40">Loading…</p>}
          {ledgerLines && ledgerLines.length === 0 && (
            <p className="text-sm text-ink/40">No journal entry found for this expense.</p>
          )}
          {ledgerLines && ledgerLines.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/50 text-xs">
                  <th className="pb-1">Account</th>
                  <th className="pb-1 text-right">Debit</th>
                  <th className="pb-1 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLines.map((line) => {
                  const account = accounts?.find((a) => a.id === line.account_id);
                  return (
                    <tr key={line.id} className="border-t border-border">
                      <td className="py-1.5">{account ? `${account.code} · ${account.name}` : line.account_id}</td>
                      <td className="py-1.5 text-right figures">{line.direction === "debit" ? formatPkr(line.amount) : ""}</td>
                      <td className="py-1.5 text-right figures">{line.direction === "credit" ? formatPkr(line.amount) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="flex justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setLedgerModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
