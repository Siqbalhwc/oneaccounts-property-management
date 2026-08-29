"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { api, Building, Account } from "@/lib/api";

type ExpenseCategory = { id: string; name: string; account_id?: string };
type Expense = {
  id: string;
  category_id: string;
  building_id?: string;
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
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [allocationsSummary, setAllocationsSummary] = useState<AllocationSummaryRow[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    category_id: "",
    building_id: "",
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
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
  }, []);

  useEffect(() => {
    function closeMenu() {
      setOpenMenuId(null);
      setMenuPos(null);
    }
    if (openMenuId) {
      document.addEventListener("click", closeMenu);
      // The menu is portaled to <body> with a fixed position computed at
      // open-time, so if the table scrolls/resizes without a re-open, just
      // close it rather than let it drift away from its row.
      window.addEventListener("scroll", closeMenu, true);
      window.addEventListener("resize", closeMenu);
      return () => {
        document.removeEventListener("click", closeMenu);
        window.removeEventListener("scroll", closeMenu, true);
        window.removeEventListener("resize", closeMenu);
      };
    }
  }, [openMenuId]);

  function openAddModal() {
    setEditingId(null);
    setError(null);
    setForm({
      category_id: categories?.[0]?.id ?? "",
      building_id: "",
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
        await api.post("/expenses", {
          category_id: form.category_id,
          building_id: form.building_id || undefined,
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
    setOpenMenuId(null);
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
        <DataTable
          keyField="id"
          rows={expenses ?? []}
          emptyMessage="No expenses logged yet."
          columns={[
            { header: "Date", accessor: (e) => e.expense_date },
            { header: "Category", accessor: (e) => categoryName(e.category_id) },
            { header: "GL account", accessor: (e) => <span className="text-xs text-ink/50">{accountLabel(e.category_id)}</span> },
            {
              header: "Paid from",
              accessor: (e) => {
                const acct = accounts?.find((a) => a.id === e.paid_from_account_id);
                return <span className="text-xs text-ink/50">{acct ? `${acct.code} · ${acct.name}` : "—"}</span>;
              },
            },
            { header: "Vendor", accessor: (e) => e.vendor_name ?? "—" },
            {
              header: "Recurs",
              accessor: (e) =>
                e.recurrence === "monthly" ? (
                  <span className="text-xs text-brass-dark font-medium">Monthly</span>
                ) : (
                  <span className="text-xs text-ink/40">One-time</span>
                ),
            },
            {
              header: "Building / Split",
              accessor: (e) =>
                e.building_id ? (
                  <span className="text-xs text-ink/60">{buildingName(e.building_id)}</span>
                ) : splitSummary(e.id) ? (
                  <span className="text-xs text-ink/60">{splitSummary(e.id)}</span>
                ) : (
                  <span className="text-xs text-stamp-red">Company-wide, not split yet</span>
                ),
            },
            {
              header: "Amount",
              accessor: (e) => <span className="figures">{formatPkr(e.amount)}</span>,
              align: "right",
            },
            {
              header: "",
              accessor: (e) => (
                <div className="relative no-print">
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (openMenuId === e.id) {
                        setOpenMenuId(null);
                        setMenuPos(null);
                        return;
                      }
                      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                      // Fixed-position menu anchored to the button's own
                      // screen coordinates, rendered via a portal straight
                      // into <body> -- so it floats above the table instead
                      // of being clipped by the table's horizontal-scroll
                      // wrapper (that clipping is what caused the cramped
                      // scrollbar look before).
                      setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
                      setOpenMenuId(e.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-ledger/5 text-ink/50"
                    title="Actions"
                  >
                    ›
                  </button>
                  {openMenuId === e.id && menuPos && typeof document !== "undefined" &&
                    createPortal(
                      <div
                        onClick={(ev) => ev.stopPropagation()}
                        style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
                        className="z-50 bg-paper border border-border rounded-card shadow-md py-1 w-40"
                      >
                        <button
                          onClick={() => { setOpenMenuId(null); setMenuPos(null); openEditModal(e); }}
                          className="block w-full text-left px-3 py-1.5 text-sm hover:bg-ledger/5"
                        >
                          Edit
                        </button>
                        {!e.building_id && (
                          <button
                            onClick={() => { setOpenMenuId(null); setMenuPos(null); openAllocationModal(e); }}
                            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-ledger/5"
                          >
                            Manage split
                          </button>
                        )}
                        <button
                          onClick={() => { setOpenMenuId(null); setMenuPos(null); openLedgerModal(e); }}
                          className="block w-full text-left px-3 py-1.5 text-sm hover:bg-ledger/5"
                        >
                          View ledger
                        </button>
                      </div>,
                      document.body
                    )}
                </div>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit expense" : "Log expense"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingId && (
            <p className="text-xs text-ink/50 bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2">
              Logging an expense records a bill your company has already paid —
              the date you enter is the date it was paid.
            </p>
          )}
          {editingId && (
            <p className="text-xs text-ink/50 bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2">
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
