"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
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
  ChevronRight,
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
import { Skeleton } from "@/components/ui/Skeleton";
import { useCountUp } from "@/components/ui/useCountUp";
import { KpiTile } from "@/components/ui/KpiTile";

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
  const router = useRouter();
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
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);

  // Trailing-12-months window (matches the month dropdown above, and comfortably
  // covers the 6-month trend chart). Used to scope the transaction-heavy
  // requests below so this page doesn't pull a growing company's entire
  // history on every load. Computed once, from the same monthOptions the UI
  // itself is bounded by.
  const windowStartDate = `${monthOptions[monthOptions.length - 1]}-01`;

  // Each dataset is fetched and rendered independently -- previously this
  // page used Promise.all(), which meant EVERY card stayed blank/zeroed
  // until the single slowest of 9 requests finished. Now each card can
  // light up as soon as its own data is back. Same endpoints, same data,
  // same company-scoped RLS on every call -- only the loading order changed.
  useEffect(() => {
    api.get<Building[]>("/buildings").then(setBuildings).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.get<Room[]>("/rooms").then(setRooms).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.get<Lease[]>("/leases").then(setLeases).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.get<Tenant[]>("/tenants").then(setTenants).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.get<ExpenseCategory[]>("/expense_categories").then(setExpenseCategories).catch((err) => setError(err.message));
  }, []);

  // Invoices: merge a recent window (covers the dropdown + trend chart)
  // with an all-time "still unpaid" set, so an overdue invoice from further
  // back is never dropped just because it's outside the recent window.
  // Both new filters are optional/additive on the backend -- every other
  // page calling GET /invoices with no params is completely unaffected.
  useEffect(() => {
    Promise.all([
      api.get<Invoice[]>(`/invoices?date_from=${windowStartDate}`),
      api.get<Invoice[]>(`/invoices?exclude_paid=true`),
    ])
      .then(([windowInvoices, unpaidInvoices]) => {
        const merged = new Map<string, Invoice>();
        [...windowInvoices, ...unpaidInvoices].forEach((i) => merged.set(i.id, i));
        setInvoices(Array.from(merged.values()));
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .get<Payment[]>(`/payments?date_from=${windowStartDate}`)
      .then(setPayments)
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .get<Expense[]>(`/expenses?date_from=${windowStartDate}`)
      .then(setExpenses)
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .get<SalaryPayment[]>(`/salary_payments?date_from=${windowStartDate}`)
      .then(setSalaryPayments)
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ---------- KPI loading state + count-up values ----------
  // Each KPI only depends on the specific datasets that feed it, so each
  // card can resolve (and animate in) independently rather than all four
  // waiting on the slowest of the three underlying fetches.
  const collectedLoading = payments === null;
  const expensesLoading = expenses === null;
  const salariesLoading = salaryPayments === null;
  const netProfitLoading = payments === null || expenses === null || salaryPayments === null;

  const collectedAnimated = useCountUp(collectedLoading ? 0 : current.collected);
  const expensesAnimated = useCountUp(expensesLoading ? 0 : current.expensesTotal);
  const salariesAnimated = useCountUp(salariesLoading ? 0 : current.salariesTotal);
  const netProfitAnimated = useCountUp(netProfitLoading ? 0 : current.netProfit);

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

  // ---------- Lookup maps (built once per data change, O(1) lookups below --
  // ---------- previously these were .find() scans repeated for every row) ----------
  const roomsById = useMemo(() => new Map((rooms ?? []).map((r) => [r.id, r])), [rooms]);
  const buildingsById = useMemo(() => new Map((buildings ?? []).map((b) => [b.id, b])), [buildings]);
  const leasesById = useMemo(() => new Map((leases ?? []).map((l) => [l.id, l])), [leases]);
  const tenantsById = useMemo(() => new Map((tenants ?? []).map((t) => [t.id, t])), [tenants]);
  const expenseCategoriesById = useMemo(
    () => new Map((expenseCategories ?? []).map((c) => [c.id, c])),
    [expenseCategories]
  );

  const roomOf = (roomId?: string) => (roomId ? roomsById.get(roomId) : undefined);
  const buildingOf = (buildingId?: string) => (buildingId ? buildingsById.get(buildingId) : undefined);
  const leaseOf = (leaseId: string) => leasesById.get(leaseId);
  const tenantOf = (tenantId?: string) => (tenantId ? tenantsById.get(tenantId) : undefined);

  // ---------- Invoices awaiting payment (all-time, soonest due first) ----------
  const awaitingPayment = useMemo(() => {
    return (invoices ?? [])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, leasesById, tenantsById, roomsById, buildingsById]);

  // ---------- Top performing buildings (collected this month) ----------
  const topBuildings = useMemo(() => {
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
    return (buildings ?? [])
      .map((b) => ({ name: b.name, amount: collectedByBuilding.get(b.id) ?? 0 }))
      .sort((a, b) => b.amount - a.amount)
      .filter((b) => b.amount > 0)
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, payments, buildings, selectedMonth, leasesById, roomsById]);
  const maxBuildingAmount = Math.max(1, ...topBuildings.map((b) => b.amount));

  // ---------- Recent activity feed (from real data, not fabricated) ----------
  type Activity = { icon: React.ReactNode; title: string; subtitle: string; amount?: string; at: string; href: string };
  const activities: Activity[] = useMemo(() => {
    return [
      ...(payments ?? []).map((p) => ({
        icon: <CreditCard size={15} />,
        title: `Payment received from ${tenantOf(p.tenant_id)?.full_name ?? "tenant"}`,
        subtitle: p.invoice_id ? "Invoice payment" : "Payment",
        amount: pkr(p.amount),
        at: p.created_at ?? p.payment_date,
        href: "/invoices",
      })),
      ...(leases ?? []).map((l) => {
        const room = roomOf(l.room_id);
        const building = buildingOf(room?.building_id);
        return {
          icon: <PlusCircle size={15} />,
          title: "New lease created",
          subtitle: room ? `${room.room_number}, ${building?.name ?? ""}` : "",
          at: (l as any).created_at ?? l.start_date,
          href: "/leases",
        };
      }),
      ...(expenses ?? []).map((e) => ({
        icon: <FileText size={15} />,
        title: "Expense added",
        subtitle: expenseCategoriesById.get(e.category_id)?.name ?? "Expense",
        amount: pkr(e.amount),
        at: e.created_at ?? e.expense_date,
        href: "/expenses",
      })),
    ]
      .filter((a) => a.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, leases, expenses, tenantsById, roomsById, buildingsById, expenseCategoriesById]);

  async function sendReminder(invoiceId: string) {
    setSendingReminderId(invoiceId);
    setReminderError(null);
    try {
      const result = (await api.post(`/invoices/${invoiceId}/whatsapp-link`, {})) as {
        whatsapp_url: string;
      };
      // Opens WhatsApp with the message pre-filled -- the user still has to
      // press Send themselves, same as the existing WhatsApp buttons
      // elsewhere in the app. This does not send anything automatically.
      window.open(result.whatsapp_url, "_blank");
    } catch (err: any) {
      setReminderError(err.message ?? "Couldn't prepare the WhatsApp reminder.");
    } finally {
      setSendingReminderId(null);
    }
  }

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
        <KpiTile
          href="/invoices"
          icon={<Wallet size={18} />}
          iconClassName="bg-ledger/10 text-ledger"
          label="Collected this month"
          value={pkr(collectedAnimated)}
          loading={collectedLoading}
          deltaText={pctChange(current.collected, previous.collected) && `${pctChange(current.collected, previous.collected)} from last month`}
          deltaTone={current.collected >= previous.collected ? "up" : "down"}
        />

        <KpiTile
          href="/expenses"
          icon={<Receipt size={18} />}
          iconClassName="bg-stamp-red/10 text-stamp-red"
          label="Expenses this month"
          value={pkr(expensesAnimated)}
          loading={expensesLoading}
          deltaText={pctChange(current.expensesTotal, previous.expensesTotal) && `${pctChange(current.expensesTotal, previous.expensesTotal)} from last month`}
          deltaTone={current.expensesTotal <= previous.expensesTotal ? "up" : "down"}
        />

        <KpiTile
          href="/reports"
          icon={<Users size={18} />}
          iconClassName="bg-brass/15 text-brass-dark"
          label="Salaries this month"
          value={pkr(salariesAnimated)}
          loading={salariesLoading}
          deltaTone="neutral"
        />

        <KpiTile
          href="/reports"
          icon={<TrendingUp size={18} />}
          iconClassName="bg-ledger/10 text-ledger"
          label="Net profit"
          value={pkr(netProfitAnimated)}
          loading={netProfitLoading}
          deltaText={pctChange(current.netProfit, previous.netProfit) && `${pctChange(current.netProfit, previous.netProfit)} from last month`}
          deltaTone={current.netProfit >= previous.netProfit ? "up" : "down"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Property overview donut */}
        <Card title="Property overview">
          {rooms === null ? (
            <div className="grid grid-cols-4 gap-2 mb-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="text-center">
                  <Skeleton className="w-9 h-9 rounded-full mx-auto mb-1.5" />
                  <Skeleton className="h-4 w-6 mx-auto" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 mb-4">
              <MiniStat icon={<Building2 size={16} />} value={buildings?.length ?? 0} label="Buildings" color="ledger" />
              <MiniStat icon={<KeyRound size={16} />} value={occupied} label="Occupied" color="ledger" />
              <MiniStat icon={<DoorOpen size={16} />} value={vacant} label="Vacant" color="brass" />
              <MiniStat icon={<Wrench size={16} />} value={maintenance} label="Repair" color="red" />
            </div>
          )}
          {rooms === null ? (
            <div className="flex items-center gap-4">
              <Skeleton className="w-[120px] h-[120px] rounded-full shrink-0" />
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ) : donutData.length > 0 ? (
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
            <p className="text-sm text-ink/45 py-6 text-center">No apartments recorded yet.</p>
          )}
        </Card>

        {/* Income vs expenses trend */}
        <Card title="Income vs expenses (last 6 months)">
          {payments === null || expenses === null ? (
            <div className="flex items-end gap-3" style={{ height: 180, paddingTop: 8 }}>
              {[62, 78, 48, 88, 68, 95].map((h, i) => (
                <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
              ))}
            </div>
          ) : (
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
          )}
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
        {reminderError && (
          <p className="text-xs text-stamp-red mb-2">{reminderError}</p>
        )}
        {invoices === null ? (
          <div className="space-y-0">
            <div className="flex gap-4 pb-2.5 border-b border-border">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16 ml-auto" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-border/60 last:border-0">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-16 ml-auto" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <DataTable
            keyField="id"
            rows={awaitingPayment}
            emptyMessage="No outstanding invoices right now."
            onRowClick={() => router.push("/invoices")}
            columns={[
              { header: "Tenant", accessor: (r) => <span className="font-medium">{r.tenantName}</span> },
              { header: "Building / Apartment", accessor: (r) => r.roomLabel },
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
              {
                header: "",
                accessor: (r) => (
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        sendReminder(r.id);
                      }}
                      disabled={sendingReminderId === r.id}
                      title="Send WhatsApp reminder"
                      className="p-1.5 rounded-full text-stamp-green hover:bg-stamp-green/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed no-print"
                    >
                      <WhatsAppIcon size={16} />
                    </button>
                    <ChevronRight size={14} className="text-ink/0 group-hover:text-ink/35 no-print" />
                  </div>
                ),
                align: "right",
              },
            ]}
          />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rent collection summary */}
        <Card title={`Rent collection — ${monthLabel(selectedMonth)}`}>
          {invoices === null || payments === null ? (
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="w-[88px] h-[88px] rounded-full" />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 w-full">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-2.5 w-14" />
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
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
          )}
        </Card>

        {/* Top performing buildings */}
        <Card title="Top performing buildings">
          {payments === null || buildings === null ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-3 w-3.5" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-2 flex-1 rounded-full" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          ) : topBuildings.length > 0 ? (
            <div className="space-y-3">
              {topBuildings.map((b, i) => (
                <button
                  key={b.name}
                  onClick={() => router.push("/buildings")}
                  className="w-full flex items-center gap-2 group rounded-card -mx-1.5 px-1.5 py-1 hover:bg-brass/[0.07] transition-colors text-left"
                >
                  <span className="text-xs text-ink/40 w-3.5">{i + 1}.</span>
                  <span className="text-sm w-20 truncate">{b.name}</span>
                  <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-ledger rounded-full"
                      style={{ width: `${(b.amount / maxBuildingAmount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs figures font-medium w-16 text-right">{pkr(b.amount)}</span>
                  <ChevronRight
                    size={13}
                    className="text-ink/0 group-hover:text-ink/35 transition-colors shrink-0 -ml-1"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink/45 py-6 text-center">No payments recorded for this month yet.</p>
          )}
        </Card>

        {/* Recent activity */}
        <Card title="Recent activity">
          {payments === null && leases === null && expenses === null ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Skeleton className="w-6 h-6 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-2.5 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities.length > 0 ? (
            <div className="space-y-0.5">
              {activities.slice(0, 5).map((a, i) => (
                <button
                  key={i}
                  onClick={() => router.push(a.href)}
                  className="w-full flex items-start gap-2.5 py-1.5 -mx-1.5 px-1.5 rounded-card hover:bg-brass/[0.07] transition-colors text-left"
                >
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
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink/45 py-6 text-center">Nothing recorded yet.</p>
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
