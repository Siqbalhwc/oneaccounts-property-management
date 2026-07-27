"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type ExpenseCategory = { id: string; name: string };
type Expense = {
  id: string;
  category_id: string;
  building_id?: string;
  amount: number;
  expense_date: string;
  description?: string;
  vendor_name?: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

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
  });

  function load() {
    api.get<Expense[]>("/expenses").then(setExpenses);
  }

  useEffect(() => {
    load();
    api.get<ExpenseCategory[]>("/expense_categories").then((cats) => {
      setCategories(cats);
      setForm((f) => (f.category_id ? f : { ...f, category_id: cats[0]?.id ?? "" }));
    });
    api.get<Building[]>("/buildings").then(setBuildings);
  }, []);

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
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      category_id: form.category_id,
      building_id: form.building_id || undefined,
      vendor_name: form.vendor_name || undefined,
      amount: parseFloat(form.amount),
      expense_date: form.expense_date,
      description: form.description || undefined,
    };
    try {
      if (editingId) {
        await api.patch(`/expenses/${editingId}`, payload);
      } else {
        await api.post("/expenses", payload);
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
        <Button onClick={openAddModal}>Log expense</Button>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={expenses ?? []}
          emptyMessage="No expenses logged yet."
          columns={[
            { header: "Date", accessor: (e) => e.expense_date },
            { header: "Category", accessor: (e) => categoryName(e.category_id) },
            { header: "Vendor", accessor: (e) => e.vendor_name ?? "—" },
            { header: "Description", accessor: (e) => e.description ?? "—" },
            {
              header: "Amount",
              accessor: (e) => <span className="figures">{formatPkr(e.amount)}</span>,
              align: "right",
            },
            {
              header: "",
              accessor: (e) => (
                <Button variant="ghost" onClick={() => openEditModal(e)} className="no-print">
                  Edit
                </Button>
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
          <Field label="Category">
            <Select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Building (optional)" hint="Leave blank for a company-wide expense.">
            <Select
              value={form.building_id}
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
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
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
    </div>
  );
}
