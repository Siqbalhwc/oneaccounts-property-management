"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

type Expense = {
  id: string;
  category_id: string;
  amount: number;
  expense_date: string;
  description?: string;
  vendor_name?: string;
};

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);

  useEffect(() => {
    api.get<Expense[]>("/expenses").then(setExpenses);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Expenses</h1>
          <p className="text-sm text-ink/55 mt-1">
            Actual bills paid — water, electricity, repairs — set against what
            was collected from tenants for the same thing.
          </p>
        </div>
        <Button>Log expense</Button>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={expenses ?? []}
          emptyMessage="No expenses logged yet."
          columns={[
            { header: "Date", accessor: (e) => e.expense_date },
            { header: "Vendor", accessor: (e) => e.vendor_name ?? "—" },
            { header: "Description", accessor: (e) => e.description ?? "—" },
            {
              header: "Amount",
              accessor: (e) => <span className="figures">{formatPkr(e.amount)}</span>,
              align: "right",
            },
          ]}
        />
      </Card>
    </div>
  );
}
