"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Select, Field } from "@/components/ui/Field";
import { api, Tenant, Lease, Room, Building, Invoice } from "@/lib/api";

type PnlRow = {
  month: string;
  total_income: number;
  total_expenses: number;
  total_salaries: number;
  net_profit: number;
};
type SecurityDeposit = {
  id: string;
  lease_id: string;
  amount_received: number;
  date_received: string;
  status: string;
  amount_refunded: number;
  date_refunded?: string;
};
type Payment = {
  id: string;
  invoice_id?: string;
  tenant_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
};
type ExpenseCategory = { id: string; name: string };
type Expense = { id: string; category_id: string; amount: number; expense_date: string };

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

const TABS = ["Profit & Loss", "Security Deposits", "Tenant Ledger", "Expenses by Category"] as const;
type Tab = (typeof TABS)[number];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("Profit & Loss");

  const [pnl, setPnl] = useState<PnlRow[] | null>(null);
  const [deposits, setDeposits] = useState<SecurityDeposit[] | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");

  useEffect(() => {
    api.get<PnlRow[]>("/reports/pnl").then(setPnl);
    api.get<SecurityDeposit[]>("/security-deposits").then(setDeposits);
    api.get<Lease[]>("/leases").then(setLeases);
    api.get<Tenant[]>("/tenants").then((data) => {
      setTenants(data);
      setSelectedTenantId((prev) => prev || data[0]?.id || "");
    });
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Invoice[]>("/invoices").then(setInvoices);
    api.get<Payment[]>("/payments").then(setPayments);
    api.get<ExpenseCategory[]>("/expense_categories").then(setCategories);
    api.get<Expense[]>("/expenses").then(setExpenses);
  }, []);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? "—";
  const leaseById = (id: string) => leases?.find((l) => l.id === id);
  const roomLabel = (roomId?: string) => {
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };

  // --- Tenant ledger (statement of account) for the selected tenant ---
  const tenantLeaseIds = (leases ?? []).filter((l) => l.tenant_id === selectedTenantId).map((l) => l.id);
  const tenantInvoices = (invoices ?? []).filter((i) => tenantLeaseIds.includes(i.lease_id));
  const tenantPayments = (payments ?? []).filter((p) => p.tenant_id === selectedTenantId);
  const totalBilled = tenantInvoices
    .filter((i) => i.status !== "cancelled")
    .reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalPaid = tenantPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balanceDue = totalBilled - totalPaid;

  // --- Expenses by category ---
  const categoryTotals = (categories ?? []).map((c) => ({
    name: c.name,
    total: (expenses ?? [])
      .filter((e) => e.category_id === c.id)
      .reduce((s, e) => s + Number(e.amount || 0), 0),
    count: (expenses ?? []).filter((e) => e.category_id === c.id).length,
  }));
  const grandTotalExpenses = categoryTotals.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Reports</h1>
        <p className="text-sm text-ink/55 mt-1">
          Profit & loss, security deposits, tenant statements, and expense breakdowns.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t
                ? "border-brass-dark text-ink"
                : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Profit & Loss" && (
        <Card>
          <DataTable
            keyField="month"
            rows={pnl ?? []}
            emptyMessage="Not enough data yet to show a P&L. Record a tenant payment first."
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
      )}

      {tab === "Security Deposits" && (
        <Card>
          <DataTable
            keyField="id"
            rows={deposits ?? []}
            emptyMessage="No security deposits recorded yet."
            columns={[
              {
                header: "Tenant",
                accessor: (d) => tenantName(leaseById(d.lease_id)?.tenant_id ?? ""),
              },
              {
                header: "Building / Room",
                accessor: (d) => roomLabel(leaseById(d.lease_id)?.room_id),
              },
              {
                header: "Received",
                accessor: (d) => <span className="figures">{formatPkr(d.amount_received)}</span>,
                align: "right",
              },
              { header: "Date received", accessor: (d) => d.date_received },
              { header: "Status", accessor: (d) => <StampBadge status={d.status} /> },
              {
                header: "Refunded",
                accessor: (d) =>
                  d.amount_refunded ? (
                    <span className="figures">{formatPkr(d.amount_refunded)}</span>
                  ) : (
                    "—"
                  ),
                align: "right",
              },
            ]}
          />
        </Card>
      )}

      {tab === "Tenant Ledger" && (
        <div className="space-y-4">
          <Card>
            <Field label="Tenant">
              <Select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
              >
                {tenants?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} — {t.cnic}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
              <div>
                <p className="text-xs uppercase tracking-wider text-ink/50">Total billed</p>
                <p className="text-lg font-display font-semibold figures mt-1">{formatPkr(totalBilled)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-ink/50">Total paid</p>
                <p className="text-lg font-display font-semibold figures mt-1">{formatPkr(totalPaid)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-ink/50">Balance due</p>
                <p className={`text-lg font-display font-semibold figures mt-1 ${balanceDue > 0 ? "text-stamp-red" : ""}`}>
                  {formatPkr(balanceDue)}
                </p>
              </div>
            </div>
          </Card>

          <Card title="Invoices">
            <DataTable
              keyField="id"
              rows={tenantInvoices}
              emptyMessage="No invoices for this tenant yet."
              columns={[
                { header: "Month", accessor: (i) => i.invoice_month },
                {
                  header: "Amount",
                  accessor: (i) => <span className="figures">{formatPkr(i.total_amount)}</span>,
                  align: "right",
                },
                { header: "Status", accessor: (i) => <StampBadge status={i.status} /> },
              ]}
            />
          </Card>

          <Card title="Payments received">
            <DataTable
              keyField="id"
              rows={tenantPayments}
              emptyMessage="No payments recorded for this tenant yet."
              columns={[
                { header: "Date", accessor: (p) => p.payment_date },
                { header: "Method", accessor: (p) => p.payment_method },
                {
                  header: "Amount",
                  accessor: (p) => <span className="figures">{formatPkr(p.amount)}</span>,
                  align: "right",
                },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === "Expenses by Category" && (
        <Card>
          <DataTable
            keyField="name"
            rows={categoryTotals}
            emptyMessage="No expenses logged yet."
            columns={[
              { header: "Category", accessor: (c) => c.name },
              { header: "# of entries", accessor: (c) => c.count, align: "right" },
              {
                header: "Total",
                accessor: (c) => <span className="figures font-medium">{formatPkr(c.total)}</span>,
                align: "right",
              },
            ]}
          />
          {categoryTotals.length > 0 && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <span className="text-sm font-semibold">Grand total</span>
              <span className="figures font-display font-semibold text-lg">
                {formatPkr(grandTotalExpenses)}
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
