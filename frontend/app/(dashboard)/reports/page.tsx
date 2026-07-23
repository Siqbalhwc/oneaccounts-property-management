"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { api } from "@/lib/api";

type PnlRow = {
  month: string;
  total_income: number;
  total_expenses: number;
  total_salaries: number;
  net_profit: number;
};

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function ReportsPage() {
  const [pnl, setPnl] = useState<PnlRow[] | null>(null);

  useEffect(() => {
    api.get<PnlRow[]>("/reports/pnl").then(setPnl);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Reports</h1>
        <p className="text-sm text-ink/55 mt-1">
          Monthly profit and loss across all buildings.
        </p>
      </div>

      <Card>
        <DataTable
          keyField="month"
          rows={pnl ?? []}
          emptyMessage="Not enough data yet to show a P&L."
          columns={[
            { header: "Month", accessor: (r) => r.month },
            {
              header: "Income",
              accessor: (r) => <span className="figures">{formatPkr(r.total_income)}</span>,
              align: "right",
            },
            {
              header: "Expenses",
              accessor: (r) => <span className="figures">{formatPkr(r.total_expenses)}</span>,
              align: "right",
            },
            {
              header: "Salaries",
              accessor: (r) => <span className="figures">{formatPkr(r.total_salaries)}</span>,
              align: "right",
            },
            {
              header: "Net profit",
              accessor: (r) => (
                <span className={`figures font-semibold ${r.net_profit < 0 ? "text-stamp-red" : ""}`}>
                  {formatPkr(r.net_profit)}
                </span>
              ),
              align: "right",
            },
          ]}
        />
      </Card>
    </div>
  );
}
