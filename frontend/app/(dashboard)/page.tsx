"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, KpiCard, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";

type PnlRow = { month: string; total_income: number; total_expenses: number; total_salaries: number; net_profit: number };
type InvoiceRow = { id: string; invoice_month: string; total_amount: number; status: string; lease_id: string };

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function DashboardHome() {
  const [pnl, setPnl] = useState<PnlRow[] | null>(null);
  const [overdueInvoices, setOverdueInvoices] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<PnlRow[]>("/reports/pnl"),
      api.get<InvoiceRow[]>("/invoices"),
    ])
      .then(([pnlData, invoices]) => {
        setPnl(pnlData);
        setOverdueInvoices(
          invoices.filter((i) => i.status === "sent" || i.status === "overdue")
        );
      })
      .catch((e) => setError(e.message));
  }, []);

  const latest = pnl?.[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Dashboard</h1>
        <p className="text-sm text-ink/55 mt-1">
          A snapshot of collections, dues, and profit across all buildings.
        </p>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">
            Couldn&apos;t reach the API — {error}. Make sure the backend is running and
            your <span className="figures">.env.local</span> is configured.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Collected this month"
          value={latest ? formatPkr(latest.total_income) : "—"}
        />
        <KpiCard
          label="Expenses this month"
          value={latest ? formatPkr(latest.total_expenses) : "—"}
        />
        <KpiCard
          label="Salaries this month"
          value={latest ? formatPkr(latest.total_salaries) : "—"}
        />
        <KpiCard
          label="Net profit"
          value={latest ? formatPkr(latest.net_profit) : "—"}
          sublabel={latest && latest.net_profit < 0 ? "Running at a loss" : undefined}
        />
      </div>

      <Card title="Invoices awaiting payment">
        <DataTable
          keyField="id"
          rows={overdueInvoices ?? []}
          emptyMessage="No outstanding invoices right now."
          columns={[
            { header: "Invoice month", accessor: (r) => r.invoice_month },
            {
              header: "Amount",
              accessor: (r) => <span className="figures">{formatPkr(r.total_amount)}</span>,
              align: "right",
            },
            { header: "Status", accessor: (r) => <StampBadge status={r.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}
