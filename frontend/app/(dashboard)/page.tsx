"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Receipt,
  Users,
  TrendingUp,
  Building2,
  KeyRound,
  DoorOpen,
  Wrench,
  CreditCard,
  FileText,
  PlusCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { api, Building, Room, Lease, Tenant, Invoice } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Select } from "@/components/ui/Field";

type Payment = {
  id: string;
  invoice_id?: string;
  tenant_id: string;
  amount: number;
  payment_date: string;
  created_at?: string;
};
type Expense = {
  id: string;
  category_id: string;
  building_id?: string;
  amount: number;
  expense_date: string;
  created_at?: string;
};
type ExpenseCategory = { id: string; name: string };
type SalaryPayment = { id: string; salary_month: string; amount_paid: number };

function pkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function pctChange(curr: number, prev: number): string | null {
  if (prev === 0) return null;
  const change = ((curr - prev) / Math.abs(prev)) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}
function relativeTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

const DONUT_COLORS = { occupied: "#2F4F3D", vacant: "#C89B5C", maintenance: "#A63D40", reserved: "#565F5A" };

export default function DashboardHome() {
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[] | null>(null);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return monthKey(d);
  });
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]);

  useEffect(() => {
    Promise.all([
      api.get<Building[]>("/buildings"),
      api.get<Room[]>("/rooms"),
      api.get<Lease[]>("/leases"),
      api.get<Tenant[]>("/tenants"),
      api.get<Invoice[]>("/invoices"),
      api.get<Payment[]>("/payments"),
      api.get<Expense[]>("/expenses"),
      api.get<ExpenseCategory[]>("/expense_categories"),
      api.get<SalaryPayment[]>("/salary_payments"),
    ])
      .then(([b, r, l, t, i, p, e, ec, sp]) => {
        setBuildings(b);
        setRooms(r);
        setLeases(l);
        setTenants(t);
        setInvoices(i);
        setPayments(p);
        setExpenses(e);
        setExpenseCategories(ec);
        setSalaryPayments(sp);
      })
      .catch((err) => setError(err.message));
  }, []);

  const loaded = buildings && rooms && leases && tenants && invoices && payments && expenses;

  // ---------- Monthly metrics (driven by the month dropdown) ----------
  function metricsFor(monthKeyStr: string) {
    const collected = (payments ?? [])
      .filter((p) => p.payment_date?.startsWith(monthKeyStr))
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const expensesTotal = (expenses ?? [])
      .filter((e) => e.expense_date?.startsWith(monthKeyStr))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const salariesTotal = (salaryPayments ?? [])
      .filter((s) => s.salary_month?.startsWith(monthKeyStr))
      .reduce((s, sp) => s + Number(sp.amount_paid || 0), 0);
    const netProfit = collected - expensesTotal - salariesTotal;
    return { collected, expensesTotal, salariesTotal, netProfit };
  }

  const current = metricsFor(selectedMonth);
  const prevMonthDate = (() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return new Date(y, m - 2, 1);
  })();
  const previous = metricsFor(monthKey(prevMonthDate));

  // ---------- Portfolio overview ----------
  const totalRooms = rooms?.length ?? 0;
  const occupied = rooms?.filter((r) => r.status === "occupied").length ?? 0;
  const vacant = rooms?.filter((r) => r.status === "vacant").length ?? 0;
  const maintenance = rooms?.filter((r) => r.status === "under_maintenance").length ?? 0;
  const reserved = rooms?.filter((r) => r.status === "reserved").length ?? 0;
  const occupancyRate = totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0;

  const donutData = [
    { name: "Occupied", value: occupied, color: DONUT_COLORS.occupied },
    { name: "Vacant", value: vacant, color: DONUT_COLORS.vacant },
    { name: "Maintenance", value: maintenance, color: DONUT_COLORS.maintenance },
    { name: "Reserved", value: reserved, color: DONUT_COLORS.reserved },
  ].filter((d) => d.value > 0);

  // ---------- Income vs expenses trend (last 6 months) ----------
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = monthKey(d);
    const m = metricsFor(key);
    return {
      label: d.toLocaleDateString("en-US", { month: "short" }),
      Income: m.collected,
      Expenses: m.expensesTotal,
    };
  });

  // ---------- Rent collection summary (selected month) ----------
  const invoicesThisMonth = (invoices ?? []).filter(
    (i) => i.invoice_month?.startsWith(selectedMonth) && i.status !== "cancelled"
  );
  const totalRent = invoicesThisMonth.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const outstanding = invoicesThisMonth
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const today = new Date();
  const overdueInvoicesThisMonth = invoicesThisMonth.filter(
    (i) => i.status !== "paid" && new Date(i.due_date) < today
  );
  const overdueTotal = overdueInvoicesThisMonth.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const collectionRate = totalRent > 0 ? (current.collected / totalRent) * 100 : 0;

  // ---------- Invoices awaiting payment (all-time, soonest due first) ----------
  const roomOf = (roomId?: string) => rooms?.find((r) => r.id === roomId);
  const buildingOf = (buildingId?: string) => buildings?.find((b) => b.id === buildingId);
  const leaseOf = (leaseId: string) => leases?.find((l) => l.id === leaseId);
  const tenantOf = (tenantId?: string) => tenants?.find((t) => t.id === tenantId);

  const awaitingPayment = (invoices ?? [])
    .filter((i) => i.status !== "paid" && i.status !== "cancelled")
    .map((i) => {
      const lease = leaseOf(i.lease_id);
      const tenant = tenantOf(lease?.tenant_id);
      const room = roomOf(lease?.room_id);
      const building = buildingOf(room?.building_id);
      const dueDate = new Date(i.due_date);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / 86400000);
      return {
        ...i,
        tenantName: tenant?.full_name ?? "—",
        roomLabel: room ? `${building?.name ?? "—"} - ${room.room_number}` : "—",
        daysOverdue,
      };
    })
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    .slice(0, 6);

  // ---------- Top performing buildings (collected this month) ----------
  const invoiceToBuilding = new Map<string, string>();
  (invoices ?? []).forEach((i) => {
    const lease = leaseOf(i.lease_id);
    const room = roomOf(lease?.room_id);
    if (room) invoiceToBuilding.set(i.id, room.building_id);
  });
  const collectedByBuilding = new Map<string, number>();
  (payments ?? [])
    .filter((p) => p.payment_date?.startsWith(selectedMonth))
    .forEach((p) => {
      if (!p.invoice_id) return;
      const buildingId = invoiceToBuilding.get(p.invoice_id);
      if (!buildingId) return;
      collectedByBuilding.set(buildingId, (collectedByBuilding.get(buildingId) ?? 0) + Number(p.amount || 0));
    });
  const topBuildings = (buildings ?? [])
    .map((b) => ({ name: b.name, amount: collectedByBuilding.get(b.id) ?? 0 }))
    .sort((a, b) => b.amount - a.amount)
    .filter((b) => b.amount > 0)
    .slice(0, 4);
  const maxBuildingAmount = Math.max(1, ...topBuildings.map((b) => b.amount));

  // ---------- Recent activity feed (from real data, not fabricated) ----------
  type Activity = { icon: React.ReactNode; title: string; subtitle: string; amount?: string; at: string };
  const activities: Activity[] = [
    ...(payments ?? []).map((p) => ({
      icon: <CreditCard size={15} />,
      title: `Payment received from ${tenantOf(p.tenant_id)?.full_name ?? "tenant"}`,
      subtitle: p.invoice_id ? "Invoice payment" : "Payment",
      amount: pkr(p.amount),
      at: p.created_at ?? p.payment_date,
    })),
    ...(leases ?? []).map((l) => {
      const room = roomOf(l.room_id);
      const building = buildingOf(room?.building_id);
      return {
        icon: <PlusCircle size={15} />,
        title: "New lease created",
        subtitle: room ? `${room.room_number}, ${building?.name ?? ""}` : "",
        at: (l as any).created_at ?? l.start_date,
      };
    }),
    ...(expenses ?? []).map((e) => ({
      icon: <FileText size={15} />,
      title: "Expense added",
      subtitle: expenseCategories?.find((c) => c.id === e.category_id)?.name ?? "Expense",
      amount: pkr(e.amount),
      at: e.created_at ?? e.expense_date,
    })),
  ]
    .filter((a) => a.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Dashboard</h1>
          <p className="text-sm text-ink/55 mt-1">
            A snapshot of collections, dues, and profit across all buildings.
          </p>
        </div>
        <Select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="sm:w-48"
        >
          {monthOptions.map((k) => (
            <option key={k} value={k}>
              {monthLabel(k)}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">
            Couldn&apos;t reach the API — {error}.
          </p>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/invoices" className="card p-5 block hover:border-brass-dark/40 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-ledger/10 text-ledger flex items-center justify-center">
              <Wallet size={18} />
            </div>
            <p className="text-xs uppercase tracking-wider text-ink/50 font-medium">Collected this month</p>
          </div>
          <p className="text-2xl font-display font-semibold figures">{pkr(current.collected)}</p>
          {pctChange(current.collected, previous.collected) && (
            <p className={`text-xs mt-1 ${current.collected >= previous.collected ? "text-stamp-green" : "text-stamp-red"}`}>
              {pctChange(current.collected, previous.collected)} from last month
            </p>
          )}
        </Link>

        <Link href="/expenses" className="card p-5 block hover:border-brass-dark/40 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-stamp-red/10 text-stamp-red flex items-center justify-center">
              <Receipt size={18} />
            </div>
            <p className="text-xs uppercase tracking-wider text-ink/50 font-medium">Expenses this month</p>
          </div>
          <p className="text-2xl font-display font-semibold figures">{pkr(current.expensesTotal)}</p>
          {pctChange(current.expensesTotal, previous.expensesTotal) && (
            <p className={`text-xs mt-1 ${current.expensesTotal <= previous.expensesTotal ? "text-stamp-green" : "text-stamp-red"}`}>
              {pctChange(current.expensesTotal, previous.expensesTotal)} from last month
            </p>
          )}
        </Link>

        <Link href="/reports" className="card p-5 block hover:border-brass-dark/40 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-brass/15 text-brass-dark flex items-center justify-center">
              <Users size={18} />
            </div>
            <p className="text-xs uppercase tracking-wider text-ink/50 font-medium">Salaries this month</p>
          </div>
          <p className="text-2xl font-display font-semibold figures">{pkr(current.salariesTotal)}</p>
        </Link>

        <Link href="/reports" className="card p-5 block hover:border-brass-dark/40 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-ledger/10 text-ledger flex items-center justify-center">
              <TrendingUp size={18} />
            </div>
            <p className="text-xs uppercase tracking-wider text-ink/50 font-medium">Net profit</p>
          </div>
          <p className="text-2xl font-display font-semibold figures">{pkr(current.netProfit)}</p>
          {pctChange(current.netProfit, previous.netProfit) && (
            <p className={`text-xs mt-1 ${current.netProfit >= previous.netProfit ? "text-stamp-green" : "text-stamp-red"}`}>
              {pctChange(current.netProfit, previous.netProfit)} from last month
            </p>
          )}
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Property overview donut */}
        <Card title="Property overview">
          <div className="grid grid-cols-4 gap-2 mb-4">
            <MiniStat icon={<Building2 size={16} />} value={buildings?.length ?? 0} label="Buildings" color="ledger" />
            <MiniStat icon={<KeyRound size={16} />} value={occupied} label="Occupied" color="ledger" />
            <MiniStat icon={<DoorOpen size={16} />} value={vacant} label="Vacant" color="brass" />
            <MiniStat icon={<Wrench size={16} />} value={maintenance} label="Repair" color="red" />
          </div>
          {donutData.length > 0 ? (
            <div className="flex items-center gap-4">
              <div style={{ width: 120, height: 120 }} className="shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius={38} outerRadius={58} paddingAngle={2}>
                      {donutData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {donutData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-ink/70">{d.name}</span>
                    <span className="figures font-medium">
                      {d.value} ({Math.round((d.value / totalRooms) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink/45 py-6 text-center">No rooms recorded yet.</p>
          )}
        </Card>

        {/* Income vs expenses trend */}
        <Card title="Income vs expenses (last 6 months)">
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={trend}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#1F2D24" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#1F2D24" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(v: number) => pkr(v)} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="Income" fill="#2F4F3D" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Expenses" fill="#A63D40" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Invoices awaiting payment */}
      <Card
        title="Invoices awaiting payment"
        action={
          <Link href="/invoices" className="text-xs text-ledger hover:underline">
            View all
          </Link>
        }
      >
        <DataTable
          keyField="id"
          rows={awaitingPayment}
          emptyMessage="No outstanding invoices right now."
          columns={[
            { header: "Tenant", accessor: (r) => r.tenantName },
            { header: "Building / Room", accessor: (r) => r.roomLabel },
            { header: "Amount", accessor: (r) => <span className="figures">{pkr(r.total_amount)}</span>, align: "right" },
            { header: "Due date", accessor: (r) => r.due_date },
            {
              header: "Status",
              accessor: (r) =>
                r.daysOverdue > 0 ? (
                  <span className="text-stamp-red font-medium text-sm">{r.daysOverdue} days overdue</span>
                ) : r.daysOverdue === 0 ? (
                  <span className="text-stamp-amber font-medium text-sm">Due today</span>
                ) : (
                  <StampBadge status={r.status} />
                ),
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rent collection summary */}
        <Card title={`Rent collection — ${monthLabel(selectedMonth)}`}>
          <div className="flex flex-col items-center gap-4">
            <ProgressRing percent={collectionRate} label="Collection rate" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 w-full">
              <div>
                <p className="text-xs text-ink/50">Total rent</p>
                <p className="figures font-medium text-sm">{pkr(totalRent)}</p>
              </div>
              <div>
                <p className="text-xs text-ink/50">Collected</p>
                <p className="figures font-medium text-sm text-stamp-green">{pkr(current.collected)}</p>
              </div>
              <div>
                <p className="text-xs text-ink/50">Outstanding</p>
                <p className="figures font-medium text-sm text-stamp-amber">{pkr(outstanding)}</p>
              </div>
              <div>
                <p className="text-xs text-ink/50">Overdue</p>
                <p className="figures font-medium text-sm text-stamp-red">
                  {pkr(overdueTotal)}{" "}
                  <span className="text-ink/40 font-normal">({overdueInvoicesThisMonth.length})</span>
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Top performing buildings */}
        <Card title="Top performing buildings">
          {topBuildings.length > 0 ? (
            <div className="space-y-3">
              {topBuildings.map((b, i) => (
                <div key={b.name} className="flex items-center gap-2">
                  <span className="text-xs text-ink/40 w-3.5">{i + 1}.</span>
                  <span className="text-sm w-20 truncate">{b.name}</span>
                  <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-ledger rounded-full"
                      style={{ width: `${(b.amount / maxBuildingAmount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs figures font-medium w-16 text-right">{pkr(b.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink/45 py-6 text-center">
              No payments recorded for this month yet.
            </p>
          )}
        </Card>

        {/* Recent activity */}
        <Card title="Recent activity">
          {activities.length > 0 ? (
            <div className="space-y-2.5">
              {activities.slice(0, 5).map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 py-1">
                  <div className="w-6 h-6 rounded-full bg-ledger/8 text-ledger flex items-center justify-center shrink-0 mt-0.5 [&>svg]:w-3 [&>svg]:h-3">
                    {a.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-tight">{a.title}</p>
                    <p className="text-[10px] text-ink/40 leading-tight mt-0.5">{relativeTime(a.at)}</p>
                  </div>
                  {a.amount && (
                    <p className="text-xs figures font-medium shrink-0">{a.amount}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink/45 py-6 text-center">
              Nothing recorded yet.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: "ledger" | "brass" | "red";
}) {
  const colorClasses = {
    ledger: "bg-ledger/10 text-ledger",
    brass: "bg-brass/15 text-brass-dark",
    red: "bg-stamp-red/10 text-stamp-red",
  }[color];
  return (
    <div className="text-center">
      <div className={`w-9 h-9 rounded-full ${colorClasses} flex items-center justify-center mx-auto mb-1.5`}>
        {icon}
      </div>
      <p className="text-lg font-display font-semibold leading-tight">{value}</p>
      <p className="text-[10px] text-ink/50">{label}</p>
    </div>
  );
}
