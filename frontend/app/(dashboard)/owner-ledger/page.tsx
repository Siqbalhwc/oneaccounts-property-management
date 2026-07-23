"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { api } from "@/lib/api";

type LedgerRow = {
  id: string;
  building_id: string;
  ledger_month: string;
  total_collected: number;
  total_expenses: number;
  amount_payable: number;
  amount_paid: number;
  status: string;
};

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function OwnerLedgerPage() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);

  useEffect(() => {
    api.get<LedgerRow[]>("/owner-ledger").then(setRows);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Owner ledger</h1>
        <p className="text-sm text-ink/55 mt-1">
          What&apos;s payable to each building&apos;s owner, month by month.
        </p>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={rows ?? []}
          emptyMessage="No ledger entries computed yet."
          columns={[
            { header: "Month", accessor: (r) => r.ledger_month },
            {
              header: "Collected",
              accessor: (r) => <span className="figures">{formatPkr(r.total_collected)}</span>,
              align: "right",
            },
            {
              header: "Expenses",
              accessor: (r) => <span className="figures">{formatPkr(r.total_expenses)}</span>,
              align: "right",
            },
            {
              header: "Payable",
              accessor: (r) => <span className="figures font-medium">{formatPkr(r.amount_payable)}</span>,
              align: "right",
            },
            { header: "Status", accessor: (r) => <StampBadge status={r.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}
