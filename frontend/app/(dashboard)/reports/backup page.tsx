"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Select, Field, Input, AmountInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PrintHeader } from "@/components/ui/PrintHeader";
import { api, Tenant, Lease, Room, Building, Invoice, Company, fetchPdfBlob } from "@/lib/api";

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
type Expense = { id: string; category_id: string; building_id?: string; amount: number; expense_date: string };
type RoomWisePayment = {
  id: string;
  amount: number;
  discount_amount: number;
  payment_date: string;
  payment_method: string | null;
};
type RoomWiseRow = {
  room_id: string;
  room_number: string;
  building_id: string;
  building_name: string;
  tenant_name: string | null;
  security_received: boolean;
  opening_balance: number;
  invoiced_period: number;
  received_period: number;
  receivable_total: number;
  current_lease_id: string | null;
  current_invoice_id: string | null;
  current_invoice_month: string | null;
  current_invoice_due_date: string | null;
  current_invoice_status: string | null;
  current_invoice_total: number | null;
  current_invoice_received: number | null;
  current_invoice_payments: RoomWisePayment[];
};
type InvoiceLineItem = { id: string; label: string; amount: number };
type InvoiceDetail = Invoice & { line_items: InvoiceLineItem[] };
type CollectionVsExpenseRow = {
  building_id: string;
  building_name: string;
  label: string;
  month: string;
  amount_billed_to_tenants: number;
};
type IncomeByHeadRow = {
  sr: number;
  lease_id: string | null;
  tenant_id: string | null;
  tenant_name: string;
  room_id: string | null;
  room_label: string;
  building_id: string | null;
  heads: Record<string, number>;
  total: number;
};
type IncomeByHeadResponse = {
  columns: string[];
  rows: IncomeByHeadRow[];
  totals: Record<string, number>;
  grand_total: number;
  reconciliation: {
    allocated_total: number;
    invoice_tied_cash_receipts_total: number;
    matches: boolean;
    note: string;
  };
};
type IncomeByHeadReceipt = {
  payment_id: string;
  invoice_id: string;
  invoice_number: string | null;
  invoice_month: string | null;
  payment_date: string;
  payment_method: string | null;
  account_id: string | null;
  account_name: string;
  notes: string | null;
  amount: number;
};
type IncomeByHeadDrilldown = { receipts: IncomeByHeadReceipt[]; total: number };

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}
function monthOf(dateStr: string) {
  return dateStr?.slice(0, 7); // "YYYY-MM"
}

const TABS = [
  "Receipts by Head",
  "Security Deposits",
  "Tenant Ledger",
  "Room-wise Receivables",
  "Expenses by Category",
  "Expenses by Month",
  "Collection vs Bills",
] as const;
type Tab = (typeof TABS)[number];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("Receipts by Head");

  const [deposits, setDeposits] = useState<SecurityDeposit[] | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [collectionVsExpense, setCollectionVsExpense] = useState<CollectionVsExpenseRow[] | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [selectedBuildingFilter, setSelectedBuildingFilter] = useState<string>("");
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>("");

  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<SecurityDeposit | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [deductions, setDeductions] = useState<{ reason: string; amount: string }[]>([]);

  const today = new Date();
  const [ibhDateFrom, setIbhDateFrom] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [ibhDateTo, setIbhDateTo] = useState(today.toISOString().slice(0, 10));
  const [ibhBuildingFilter, setIbhBuildingFilter] = useState("");
  const [ibhData, setIbhData] = useState<IncomeByHeadResponse | null>(null);
  const [ibhLoading, setIbhLoading] = useState(false);
  const [ibhError, setIbhError] = useState<string | null>(null);
  const [ibhBackfilling, setIbhBackfilling] = useState(false);
  const [ibhBackfillMessage, setIbhBackfillMessage] = useState<string | null>(null);
  const [ibhDrilldown, setIbhDrilldown] = useState<{
    row: IncomeByHeadRow;
    label: string;
    data: IncomeByHeadDrilldown | null;
    loading: boolean;
  } | null>(null);

  const [roomWiseRows, setRoomWiseRows] = useState<RoomWiseRow[] | null>(null);
  const [roomWiseLoading, setRoomWiseLoading] = useState(false);
  const [roomWiseError, setRoomWiseError] = useState<string | null>(null);
  const [roomWisePeriodStart, setRoomWisePeriodStart] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [roomWisePeriodEnd, setRoomWisePeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [roomWiseBuildingFilter, setRoomWiseBuildingFilter] = useState("");

  // Room-wise drill-down: click a room row -> see its current invoice +
  // payments -> click that invoice -> full invoice detail (line items).
  const [roomDrilldownRow, setRoomDrilldownRow] = useState<RoomWiseRow | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  const [invoiceDetailError, setInvoiceDetailError] = useState<string | null>(null);
  const [invoicePdfLoading, setInvoicePdfLoading] = useState(false);

  function loadDeposits() {
    api.get<SecurityDeposit[]>("/security-deposits").then(setDeposits);
  }

  // leases is now built up from two targeted fetches instead of one fetch
  // of every lease the company has ever had: the selected tenant's leases
  // (for the Tenant Statement tab) and the leases referenced by whichever
  // security deposits are loaded (for the Security Deposits tab) -- the
  // two effects below, merged into the same `leases` state.
  useEffect(() => {
    api.get<Company>("/company/me").then(setCompany);
    loadDeposits();
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
    api
      .get<{ billed_to_tenants: CollectionVsExpenseRow[] }>("/reports/collection-vs-expense")
      .then((res) => setCollectionVsExpense(res.billed_to_tenants ?? []));
  }, []);

  function loadIncomeByHead() {
    setIbhLoading(true);
    setIbhError(null);
    const params = new URLSearchParams({ date_from: ibhDateFrom, date_to: ibhDateTo });
    if (ibhBuildingFilter) params.set("building_id", ibhBuildingFilter);
    api
      .get<IncomeByHeadResponse>(`/reports/income-by-head?${params.toString()}`)
      .then(setIbhData)
      .catch((err: any) => setIbhError(err.message))
      .finally(() => setIbhLoading(false));
  }

  useEffect(() => {
    loadIncomeByHead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openIncomeByHeadCell(row: IncomeByHeadRow, label: string) {
    if (!row.heads[label]) return;
    setIbhDrilldown({ row, label, data: null, loading: true });
    const params = new URLSearchParams({ label, date_from: ibhDateFrom, date_to: ibhDateTo });
    if (row.lease_id) params.set("lease_id", row.lease_id);
    else if (row.tenant_id) params.set("tenant_id", row.tenant_id);
    try {
      const result = await api.get<IncomeByHeadDrilldown>(`/reports/income-by-head/drilldown?${params.toString()}`);
      setIbhDrilldown({ row, label, data: result, loading: false });
    } catch (err: any) {
      setIbhDrilldown(null);
      setIbhError(err.message);
    }
  }

  async function runIncomeByHeadBackfill() {
    setIbhBackfilling(true);
    setIbhBackfillMessage(null);
    try {
      const result = await api.post<{
        payments_processed: number;
        payments_already_allocated: number;
        payments_skipped_no_line_items: number;
      }>("/reports/income-by-head/backfill");
      setIbhBackfillMessage(
        `Done — ${result.payments_processed} historical receipt(s) split by head just now (${result.payments_already_allocated} were already done).`
      );
      loadIncomeByHead();
    } catch (err: any) {
      setIbhBackfillMessage(`Couldn't backfill — ${err.message}`);
    } finally {
      setIbhBackfilling(false);
    }
  }

  function loadRoomWise() {
    setRoomWiseLoading(true);
    setRoomWiseError(null);
    const params = new URLSearchParams({
      period_start: roomWisePeriodStart,
      period_end: roomWisePeriodEnd,
    });
    if (roomWiseBuildingFilter) params.set("building_id", roomWiseBuildingFilter);
    api
      .get<RoomWiseRow[]>(`/reports/room-wise?${params.toString()}`)
      .then(setRoomWiseRows)
      .catch((err) => setRoomWiseError(err.message))
      .finally(() => setRoomWiseLoading(false));
  }

  useEffect(() => {
    loadRoomWise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openRoomDrilldown(row: RoomWiseRow) {
    setRoomDrilldownRow(row);
  }

  function closeRoomDrilldown() {
    setRoomDrilldownRow(null);
  }

  async function openInvoiceDetail(invoiceId: string) {
    setInvoiceDetail(null);
    setInvoiceDetailError(null);
    setInvoiceDetailLoading(true);
    try {
      const detail = await api.get<InvoiceDetail>(`/invoices/${invoiceId}`);
      setInvoiceDetail(detail);
    } catch (err: any) {
      setInvoiceDetailError(err.message);
    } finally {
      setInvoiceDetailLoading(false);
    }
  }

  function closeInvoiceDetail() {
    setInvoiceDetail(null);
    setInvoiceDetailError(null);
  }

  async function handleViewInvoicePdf(invoiceId: string) {
    setInvoicePdfLoading(true);
    try {
      const blob = await fetchPdfBlob(`/invoices/${invoiceId}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: any) {
      alert(err.message || "Couldn't open the invoice PDF.");
    } finally {
      setInvoicePdfLoading(false);
    }
  }

  function mergeLeasesIn(newOnes: Lease[]) {
    setLeases((prev) => {
      const merged = new Map((prev ?? []).map((l) => [l.id, l]));
      newOnes.forEach((l) => merged.set(l.id, l));
      return Array.from(merged.values());
    });
  }

  useEffect(() => {
    if (!selectedTenantId) return;
    api.get<Lease[]>(`/leases?tenant_id=${selectedTenantId}`).then(mergeLeasesIn);
  }, [selectedTenantId]);

  useEffect(() => {
    const leaseIds = Array.from(new Set((deposits ?? []).map((d) => d.lease_id).filter(Boolean)));
    if (leaseIds.length === 0) return;
    api.get<Lease[]>(`/leases?ids=${leaseIds.join(",")}`).then(mergeLeasesIn);
  }, [deposits]);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? "—";
  const leaseById = (id: string) => leases?.find((l) => l.id === id);
  const roomLabel = (roomId?: string) => {
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };
  const categoryName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "—";

  function openRefundModal(deposit: SecurityDeposit) {
    setRefundTarget(deposit);
    setRefundError(null);
    setRefundDate(new Date().toISOString().slice(0, 10));
    setDeductions([]);
    setRefundModalOpen(true);
  }

  function addDeduction() {
    setDeductions((prev) => [...prev, { reason: "", amount: "" }]);
  }

  function updateDeduction(index: number, field: "reason" | "amount", value: string) {
    setDeductions((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
  }

  function removeDeduction(index: number) {
    setDeductions((prev) => prev.filter((_, i) => i !== index));
  }

  const totalDeductions = deductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
  const netRefund = refundTarget ? Number(refundTarget.amount_received) - totalDeductions : 0;

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundTarget) return;
    setRefundSaving(true);
    setRefundError(null);
    try {
      await api.post(`/security-deposits/${refundTarget.id}/refund`, {
        deductions: deductions
          .filter((d) => d.reason && d.amount)
          .map((d) => ({ reason: d.reason, amount: parseFloat(d.amount) })),
        refund_date: refundDate,
      });
      setRefundModalOpen(false);
      loadDeposits();
    } catch (err: any) {
      setRefundError(err.message);
    } finally {
      setRefundSaving(false);
    }
  }

  // --- Tenant ledger ---
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
    total: (expenses ?? []).filter((e) => e.category_id === c.id).reduce((s, e) => s + Number(e.amount || 0), 0),
    count: (expenses ?? []).filter((e) => e.category_id === c.id).length,
  }));
  const grandTotalExpenses = categoryTotals.reduce((s, c) => s + c.total, 0);

  // --- Expenses by month ---
  const expenseMonths = Array.from(
    new Set((expenses ?? []).map((e) => monthOf(e.expense_date)))
  ).sort((a, b) => b.localeCompare(a));
  const monthlyExpenseTotals = expenseMonths.map((m) => ({
    month: m,
    total: (expenses ?? [])
      .filter((e) => monthOf(e.expense_date) === m)
      .reduce((s, e) => s + Number(e.amount || 0), 0),
    count: (expenses ?? []).filter((e) => monthOf(e.expense_date) === m).length,
  }));

  // --- Collection vs bills ---
  const buildingsForFilter = buildings ?? [];
  const availableMonths = Array.from(
    new Set((collectionVsExpense ?? []).map((r) => monthOf(r.month)))
  ).sort((a, b) => b.localeCompare(a));
  const filteredCollectionVsExpense = (collectionVsExpense ?? []).filter((r) => {
    if (selectedBuildingFilter && r.building_id !== selectedBuildingFilter) return false;
    if (selectedMonthFilter && monthOf(r.month) !== selectedMonthFilter) return false;
    return true;
  });
  // Match each billed line-item to the actual expense total for the same building+category+month
  const collectionVsExpenseRows = filteredCollectionVsExpense.map((r) => {
    const matchingCategory = categories?.find(
      (c) => c.name.toLowerCase() === r.label.toLowerCase()
    );
    const actualExpense = (expenses ?? [])
      .filter(
        (e) =>
          e.building_id === r.building_id &&
          matchingCategory &&
          e.category_id === matchingCategory.id &&
          monthOf(e.expense_date) === monthOf(r.month)
      )
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    return {
      ...r,
      rowKey: `${r.building_id}-${r.label}-${r.month}`,
      actualExpense,
      diff: Number(r.amount_billed_to_tenants) - actualExpense,
    };
  });


  return (
    <div className="space-y-6">
      <PrintHeader company={company} reportTitle={tab} />
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Reports</h1>
          <p className="text-sm text-ink/55 mt-1">
            Receipts by head, security deposits, tenant statements, and expense breakdowns.
          </p>
        </div>
        <Button variant="secondary" onClick={() => window.print()} className="no-print">
          <Printer size={15} /> Print this report
        </Button>
      </div>

      <div className="flex gap-2 border-b border-border overflow-x-auto scrollbar-hide no-print">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t ? "border-brass-dark text-ink" : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Receipts by Head" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 no-print">
            <Field label="From">
              <Input type="date" value={ibhDateFrom} onChange={(e) => setIbhDateFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={ibhDateTo} onChange={(e) => setIbhDateTo(e.target.value)} />
            </Field>
            <Field label="Building">
              <Select value={ibhBuildingFilter} onChange={(e) => setIbhBuildingFilter(e.target.value)}>
                <option value="">All buildings</option>
                {(buildings ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button variant="secondary" onClick={loadIncomeByHead} disabled={ibhLoading} className="w-full">
                {ibhLoading ? "Loading…" : "Apply"}
              </Button>
            </div>
          </div>

          {ibhError && (
            <Card className="border-stamp-red/40">
              <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {ibhError}.</p>
            </Card>
          )}

          {ibhData && !ibhData.reconciliation.matches && (
            <Card className="border-brass/40 no-print">
              <p className="text-sm text-ink/70">
                <span className="font-medium text-brass-dark">Heads up:</span> allocated total (
                {formatPkr(ibhData.reconciliation.allocated_total)}) doesn&apos;t yet match invoice-tied cash
                receipts for this period ({formatPkr(ibhData.reconciliation.invoice_tied_cash_receipts_total)}).
                This almost always means some receipts predate this report and haven&apos;t been split by
                head yet.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Button variant="secondary" onClick={runIncomeByHeadBackfill} disabled={ibhBackfilling}>
                  {ibhBackfilling ? "Backfilling…" : "Backfill historical receipts"}
                </Button>
                {ibhBackfillMessage && <p className="text-xs text-ink/55">{ibhBackfillMessage}</p>}
              </div>
            </Card>
          )}

          <Card>
            <p className="text-xs text-ink/45 mb-3 no-print">
              Click any amount to see exactly which receipt(s) — and which bank/cash account(s) — made it up.
            </p>
            <DataTable
              keyField="sr"
              rows={ibhData?.rows ?? []}
              emptyMessage="No receipts recorded against any invoice in this period."
              columns={[
                { header: "Sr", accessor: (r) => r.sr },
                { header: "Tenant", accessor: (r) => <span className="font-medium">{r.tenant_name}</span> },
                { header: "Room / Apartment", accessor: (r) => r.room_label },
                ...(ibhData?.columns ?? []).map((c) => ({
                  header: c,
                  accessor: (r: IncomeByHeadRow) =>
                    r.heads[c] ? (
                      <button
                        onClick={() => openIncomeByHeadCell(r, c)}
                        className="figures underline decoration-dotted decoration-ink/30 hover:decoration-ink hover:text-brass-dark"
                      >
                        {formatPkr(r.heads[c])}
                      </button>
                    ) : (
                      <span className="text-ink/30">—</span>
                    ),
                  align: "right" as const,
                })),
                {
                  header: "Total",
                  accessor: (r) => <span className="figures font-semibold">{formatPkr(r.total)}</span>,
                  align: "right",
                },
              ]}
            />
            {ibhData && ibhData.rows.length > 0 && (
              <div className="flex flex-wrap justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
                {ibhData.columns.map((c) => (
                  <span key={c}>
                    {c}: <span className="figures">{formatPkr(ibhData.totals[c] ?? 0)}</span>
                  </span>
                ))}
                <span>
                  Grand total: <span className="figures">{formatPkr(ibhData.grand_total)}</span>
                </span>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "Security Deposits" && (
        <Card>
          <DataTable
            keyField="id"
            rows={deposits ?? []}
            emptyMessage="No security deposits recorded yet."
            columns={[
              { header: "Tenant", accessor: (d) => tenantName(leaseById(d.lease_id)?.tenant_id ?? "") },
              { header: "Building / Apartment", accessor: (d) => roomLabel(leaseById(d.lease_id)?.room_id) },
              { header: "Received", accessor: (d) => <span className="figures">{formatPkr(d.amount_received)}</span>, align: "right" },
              { header: "Date received", accessor: (d) => d.date_received },
              { header: "Status", accessor: (d) => <StampBadge status={d.status} /> },
              {
                header: "Refunded",
                accessor: (d) => (d.amount_refunded ? <span className="figures">{formatPkr(d.amount_refunded)}</span> : "—"),
                align: "right",
              },
              {
                header: "",
                accessor: (d) =>
                  d.status !== "refunded" ? (
                    <Button variant="secondary" onClick={() => openRefundModal(d)} className="no-print">
                      Refund
                    </Button>
                  ) : null,
                align: "right",
              },
            ]}
          />
        </Card>
      )}

      {tab === "Tenant Ledger" && (
        <div className="space-y-4">
          <Card>
            <div className="no-print">
              <Field label="Tenant">
                <Select value={selectedTenantId} onChange={(e) => setSelectedTenantId(e.target.value)}>
                  {tenants?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name} — {t.cnic}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {selectedTenantId && (
              <p className="text-sm font-medium mt-3 hidden print:block">
                {tenantName(selectedTenantId)}
              </p>
            )}
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
                { header: "Amount", accessor: (i) => <span className="figures">{formatPkr(i.total_amount)}</span>, align: "right" },
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
                { header: "Amount", accessor: (p) => <span className="figures">{formatPkr(p.amount)}</span>, align: "right" },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === "Room-wise Receivables" && (
        <div className="space-y-4">
          <Card className="no-print">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Period from" hint="Everything before this date rolls into opening balance.">
                <Input
                  type="date"
                  value={roomWisePeriodStart}
                  onChange={(e) => setRoomWisePeriodStart(e.target.value)}
                />
              </Field>
              <Field label="Period to">
                <Input type="date" value={roomWisePeriodEnd} onChange={(e) => setRoomWisePeriodEnd(e.target.value)} />
              </Field>
              <Field label="Building">
                <Select value={roomWiseBuildingFilter} onChange={(e) => setRoomWiseBuildingFilter(e.target.value)}>
                  <option value="">All buildings</option>
                  {buildingsForFilter.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex justify-end mt-3">
              <Button variant="secondary" onClick={loadRoomWise} disabled={roomWiseLoading}>
                {roomWiseLoading ? "Loading…" : "Apply"}
              </Button>
            </div>
          </Card>

          <p className="hidden print:block text-xs text-ink/50">
            {roomWisePeriodStart} to {roomWisePeriodEnd}
            {roomWiseBuildingFilter
              ? ` — ${buildingsForFilter.find((b) => b.id === roomWiseBuildingFilter)?.name ?? ""}`
              : ""}
          </p>

          {roomWiseError && (
            <Card className="border-stamp-red/40">
              <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {roomWiseError}.</p>
            </Card>
          )}

          <Card>
            <p className="text-xs text-ink/45 mb-3 no-print">
              Click a room to drill down into its current invoice and payments.
            </p>
            <DataTable
              keyField="room_id"
              rows={roomWiseRows ?? []}
              emptyMessage="No rooms match this filter."
              onRowClick={(r) => openRoomDrilldown(r)}
              columns={[
                {
                  header: "Room",
                  accessor: (r) => (
                    <span className="font-medium">
                      {r.building_name} — {r.room_number}
                    </span>
                  ),
                },
                { header: "Tenant", accessor: (r) => r.tenant_name ?? "—" },
                {
                  header: "Security",
                  accessor: (r) => <StampBadge status={r.security_received ? "paid" : "pending"} />,
                },
                {
                  header: "Opening bal.",
                  accessor: (r) => <span className="figures">{formatPkr(r.opening_balance)}</span>,
                  align: "right",
                },
                {
                  header: "Invoiced",
                  accessor: (r) => <span className="figures">{formatPkr(r.invoiced_period)}</span>,
                  align: "right",
                },
                {
                  header: "Received",
                  accessor: (r) => <span className="figures">{formatPkr(r.received_period)}</span>,
                  align: "right",
                },
                {
                  header: "Receivable",
                  accessor: (r) => (
                    <span className={`figures font-semibold ${r.receivable_total > 0 ? "text-stamp-red" : ""}`}>
                      {formatPkr(r.receivable_total)}
                    </span>
                  ),
                  align: "right",
                },
              ]}
            />
            {roomWiseRows && roomWiseRows.length > 0 && (
              <div className="flex flex-wrap justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
                <span>
                  Opening:{" "}
                  <span className="figures">
                    {formatPkr(roomWiseRows.reduce((s, r) => s + r.opening_balance, 0))}
                  </span>
                </span>
                <span>
                  Invoiced:{" "}
                  <span className="figures">
                    {formatPkr(roomWiseRows.reduce((s, r) => s + r.invoiced_period, 0))}
                  </span>
                </span>
                <span>
                  Received:{" "}
                  <span className="figures">
                    {formatPkr(roomWiseRows.reduce((s, r) => s + r.received_period, 0))}
                  </span>
                </span>
                <span>
                  Total receivable:{" "}
                  <span className="figures">
                    {formatPkr(roomWiseRows.reduce((s, r) => s + r.receivable_total, 0))}
                  </span>
                </span>
              </div>
            )}
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
              { header: "Total", accessor: (c) => <span className="figures font-medium">{formatPkr(c.total)}</span>, align: "right" },
            ]}
          />
          {categoryTotals.length > 0 && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <span className="text-sm font-semibold">Grand total</span>
              <span className="figures font-display font-semibold text-lg">{formatPkr(grandTotalExpenses)}</span>
            </div>
          )}
        </Card>
      )}

      {tab === "Expenses by Month" && (
        <Card>
          <DataTable
            keyField="month"
            rows={monthlyExpenseTotals}
            emptyMessage="No expenses logged yet."
            columns={[
              { header: "Month", accessor: (r) => r.month },
              { header: "# of entries", accessor: (r) => r.count, align: "right" },
              { header: "Total", accessor: (r) => <span className="figures font-medium">{formatPkr(r.total)}</span>, align: "right" },
            ]}
          />
        </Card>
      )}

      {tab === "Collection vs Bills" && (
        <div className="space-y-4">
          <Card className="no-print">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Building">
                <Select value={selectedBuildingFilter} onChange={(e) => setSelectedBuildingFilter(e.target.value)}>
                  <option value="">All buildings</option>
                  {buildingsForFilter.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Month">
                <Select value={selectedMonthFilter} onChange={(e) => setSelectedMonthFilter(e.target.value)}>
                  <option value="">All months</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>
          <Card title="What tenants were billed vs. what was actually paid out">
            <DataTable
              keyField="rowKey"
              rows={collectionVsExpenseRows}
              emptyMessage="Not enough invoice data yet to compare."
              columns={[
                { header: "Building", accessor: (r) => r.building_name },
                { header: "Fee", accessor: (r) => r.label },
                { header: "Month", accessor: (r) => monthOf(r.month) },
                {
                  header: "Billed to tenants",
                  accessor: (r) => <span className="figures">{formatPkr(r.amount_billed_to_tenants)}</span>,
                  align: "right",
                },
                {
                  header: "Actual expense paid",
                  accessor: (r) => <span className="figures">{formatPkr(r.actualExpense)}</span>,
                  align: "right",
                },
                {
                  header: "Difference",
                  accessor: (r) => (
                    <span className={`figures font-medium ${r.diff < 0 ? "text-stamp-red" : "text-stamp-green"}`}>
                      {formatPkr(r.diff)}
                    </span>
                  ),
                  align: "right",
                },
              ]}
            />
            <p className="text-xs text-ink/40 mt-3">
              A positive difference means you collected more from tenants than you
              actually spent on that fee; negative means you spent more than you collected.
              Matching is based on the fee name (e.g. "Water bill") matching an expense category of the same name.
            </p>
          </Card>
        </div>
      )}

      <Modal
        open={refundModalOpen}
        onClose={() => setRefundModalOpen(false)}
        title="Refund security deposit"
      >
        {refundTarget && (
          <form onSubmit={handleRefund} className="space-y-4">
            <p className="text-xs text-ink/50 bg-accent/5 border border-accent/15 rounded-card px-3 py-2">
              {tenantName(leaseById(refundTarget.lease_id)?.tenant_id ?? "")} —{" "}
              {roomLabel(leaseById(refundTarget.lease_id)?.room_id)} — held:{" "}
              <span className="figures font-medium">{formatPkr(refundTarget.amount_received)}</span>
            </p>

            <div>
              <p className="text-sm font-medium mb-2">Deductions (optional)</p>
              {deductions.map((d, i) => (
                <div key={i} className="flex items-end gap-2 mb-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Reason (e.g. wall damage)"
                      value={d.reason}
                      onChange={(e) => updateDeduction(i, "reason", e.target.value)}
                    />
                  </div>
                  <div className="w-32">
                    <AmountInput
                      value={d.amount}
                      onChange={(e) => updateDeduction(i, "amount", e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeDeduction(i)}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={addDeduction}>
                + Add deduction
              </Button>
            </div>

            <Field label="Refund date">
              <Input type="date" required value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
            </Field>

            <div className="ledger-rule pt-3 flex justify-between items-center">
              <span className="text-sm font-medium">Net refund</span>
              <span className="text-lg font-display font-semibold figures">{formatPkr(netRefund)}</span>
            </div>

            {refundError && <p className="text-sm text-stamp-red">{refundError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setRefundModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={refundSaving || netRefund < 0}>
                {refundSaving ? "Processing…" : "Refund deposit"}
              </Button>
            </div>
            {netRefund < 0 && (
              <p className="text-xs text-stamp-red">Deductions can&apos;t exceed the amount held.</p>
            )}
          </form>
        )}
      </Modal>

      {/* Room-wise Receivables drill-down, step 1: current invoice + its payments */}
      <Modal
        open={!!roomDrilldownRow}
        onClose={closeRoomDrilldown}
        title={
          roomDrilldownRow
            ? `${roomDrilldownRow.building_name} — ${roomDrilldownRow.room_number}`
            : "Room detail"
        }
      >
        {roomDrilldownRow && (
          <div className="space-y-4">
            <div className="text-sm bg-accent/5 border border-accent/15 rounded-card px-3 py-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-ink/50">Tenant</span>
                <span className="font-medium">{roomDrilldownRow.tenant_name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/50">Receivable (as of period end)</span>
                <span
                  className={`figures font-medium ${
                    roomDrilldownRow.receivable_total > 0 ? "text-stamp-red" : ""
                  }`}
                >
                  {formatPkr(roomDrilldownRow.receivable_total)}
                </span>
              </div>
            </div>

            {!roomDrilldownRow.current_invoice_id ? (
              <p className="text-sm text-ink/45 py-4 text-center border border-dashed border-border rounded-card">
                No invoice has been generated for this room&apos;s current tenant yet.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-wider text-ink/45 font-medium">Current invoice</p>
                <button
                  onClick={() => openInvoiceDetail(roomDrilldownRow.current_invoice_id!)}
                  className="group w-full text-left border border-border rounded-card px-3 py-3 hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-sm">{roomDrilldownRow.current_invoice_month}</span>
                    <StampBadge status={roomDrilldownRow.current_invoice_status ?? "draft"} />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink/50">Due {roomDrilldownRow.current_invoice_due_date}</span>
                    <span className="figures font-medium">{formatPkr(roomDrilldownRow.current_invoice_total ?? 0)}</span>
                  </div>
                  <p className="text-xs text-accent mt-2 group-hover:underline">
                    Click to view complete invoice details →
                  </p>
                </button>

                <div>
                  <p className="text-xs uppercase tracking-wider text-ink/45 font-medium mb-2">
                    Payments against this invoice
                  </p>
                  {roomDrilldownRow.current_invoice_payments.length === 0 ? (
                    <p className="text-sm text-ink/40">No payments recorded against this invoice yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {roomDrilldownRow.current_invoice_payments.map((p) => (
                        <div key={p.id} className="flex justify-between text-sm">
                          <span className="text-ink/70">
                            {p.payment_date}
                            {p.payment_method ? ` · ${p.payment_method}` : ""}
                          </span>
                          <span className="figures">
                            {formatPkr(p.amount + (p.discount_amount || 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold pt-2 mt-2 border-t border-border">
                    <span>Received on this invoice</span>
                    <span className="figures">{formatPkr(roomDrilldownRow.current_invoice_received ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink/50">Balance on this invoice</span>
                    <span className="figures">
                      {formatPkr(
                        (roomDrilldownRow.current_invoice_total ?? 0) -
                          (roomDrilldownRow.current_invoice_received ?? 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Room-wise Receivables drill-down, step 2: complete invoice details */}
      <Modal
        open={!!invoiceDetail || invoiceDetailLoading || !!invoiceDetailError}
        onClose={closeInvoiceDetail}
        title={invoiceDetail ? `Invoice ${invoiceDetail.invoice_number ?? ""}` : "Invoice detail"}
      >
        {invoiceDetailLoading && <p className="text-sm text-ink/45 py-6 text-center">Loading invoice…</p>}
        {invoiceDetailError && <p className="text-sm text-stamp-red">{invoiceDetailError}</p>}
        {invoiceDetail && !invoiceDetailLoading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-ink/50">Invoice month</p>
                <p className="font-medium">{invoiceDetail.invoice_month}</p>
              </div>
              <div>
                <p className="text-ink/50">Due date</p>
                <p className="font-medium">{invoiceDetail.due_date}</p>
              </div>
              <div>
                <p className="text-ink/50">Status</p>
                <StampBadge status={invoiceDetail.status} />
              </div>
              <div>
                <p className="text-ink/50">Total amount</p>
                <p className="figures font-semibold">{formatPkr(invoiceDetail.total_amount)}</p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-ink/45 font-medium mb-2">Line items</p>
              <div className="space-y-1.5">
                {invoiceDetail.line_items.map((li) => (
                  <div key={li.id} className="flex justify-between text-sm">
                    <span className="text-ink/70">{li.label}</span>
                    <span className="figures">{formatPkr(li.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold pt-2 mt-1 border-t border-border">
                  <span>Total</span>
                  <span className="figures">{formatPkr(invoiceDetail.total_amount)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" variant="ghost" onClick={closeInvoiceDetail}>
                Close
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleViewInvoicePdf(invoiceDetail.id)}
                disabled={invoicePdfLoading}
              >
                {invoicePdfLoading ? "Opening…" : "View / print PDF"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={!!ibhDrilldown}
        onClose={() => setIbhDrilldown(null)}
        title={ibhDrilldown ? `${ibhDrilldown.label} — ${ibhDrilldown.row.tenant_name}` : "Receipts"}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            {ibhDrilldown?.row.room_label} — every bank/cash receipt that makes up this amount.
          </p>
          {ibhDrilldown?.loading && <p className="text-sm text-ink/45">Loading…</p>}
          {ibhDrilldown?.data && (
            <>
              <div className="space-y-2">
                {ibhDrilldown.data.receipts.map((r) => (
                  <div
                    key={r.payment_id}
                    className="flex items-center justify-between border border-border rounded-card px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">{r.account_name}</p>
                      <p className="text-xs text-ink/50">
                        {r.payment_date}
                        {r.payment_method ? ` · ${r.payment_method}` : ""}
                        {r.invoice_number ? ` · Invoice ${r.invoice_number}` : ""}
                      </p>
                    </div>
                    <span className="figures font-medium">{formatPkr(r.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border">
                <span>Total</span>
                <span className="figures">{formatPkr(ibhDrilldown.data.total)}</span>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
