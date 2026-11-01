"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PrintHeader } from "@/components/ui/PrintHeader";
import { api, Building, Company, downloadFile } from "@/lib/api";
import { useLabels } from "@/lib/labels";
import { firstOfMonthYmd, todayYmd } from "@/lib/dates";

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
  paid_against_security: number;
  net: number;
  is_other?: boolean;
};

type SettlementRow = {
  sr: number;
  lease_id: string | null;
  tenant_id: string | null;
  tenant_name: string;
  room_label: string;
  settled_on: string;
  heads: Record<string, number>;
  settled_total: number;
  refund_paid: number;
  refund_account: string | null;
  deposit_released: number;
};

type IncomeByHeadResponse = {
  columns: string[];
  rows: IncomeByHeadRow[];
  totals: Record<string, number>;
  grand_total: number;
  paid_total: number;
  net_total: number;
  settlement: {
    columns: string[];
    rows: SettlementRow[];
    totals: Record<string, number>;
    settled_total: number;
    refund_total: number;
    deposit_released_total: number;
  };
  reconciliation: {
    books_total: number;
    report_total: number;
    gap: number;
    paid_books: number;
    paid_report: number;
    paid_gap: number;
    matches: boolean;
    by_source: { source: string; books: number; report: number }[];
    unsplit_invoice_receipts: number;
    note: string;
  };
};

type Receipt = {
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

type DrilldownResponse = { receipts: Receipt[]; total: number };

// Plain number: the page says "Amounts in Rs" once, top right, instead of
// repeating "Rs" on every figure.
function formatPkr(n: number) {
  return Number(n || 0).toLocaleString("en-PK");
}


export default function ReceiptsByHeadReport({ embedded = false }: { embedded?: boolean }) {
  const { L } = useLabels();
  const [dateFrom, setDateFrom] = useState(firstOfMonthYmd());
  const [dateTo, setDateTo] = useState(todayYmd());
  const [buildingFilter, setBuildingFilter] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [company, setCompany] = useState<Company | null>(null);

  const [data, setData] = useState<IncomeByHeadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const [drilldown, setDrilldown] = useState<{
    row: { tenant_name: string; room_label: string };
    label: string;
    data: DrilldownResponse | null;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Company>("/company/me").then(setCompany);
  }, []);

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (buildingFilter) params.set("building_id", buildingFilter);
    api
      .get<IncomeByHeadResponse>(`/reports/income-by-head?${params.toString()}`)
      .then(setData)
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openCell(row: IncomeByHeadRow, label: string) {
    if (label === "Paid against security" ? !row.paid_against_security : !row.heads[label]) return;
    setDrilldown({ row, label, data: null, loading: true });
    const params = new URLSearchParams({ label, date_from: dateFrom, date_to: dateTo });
    if (row.lease_id) params.set("lease_id", row.lease_id);
    if (row.tenant_id) params.set("tenant_id", row.tenant_id);
    try {
      const result = await api.get<DrilldownResponse>(`/reports/income-by-head/drilldown?${params.toString()}`);
      setDrilldown({ row, label, data: result, loading: false });
    } catch (err: any) {
      setDrilldown(null);
      setError(err.message);
    }
  }

  async function openSettlementCell(row: SettlementRow, label: string) {
    if (!row.lease_id) return;
    setDrilldown({ row, label, data: null, loading: true });
    const params = new URLSearchParams({ label, date_from: row.settled_on, date_to: row.settled_on, part: "settlement", lease_id: row.lease_id });
    try {
      const result = await api.get<DrilldownResponse>(`/reports/income-by-head/drilldown?${params.toString()}`);
      setDrilldown({ row, label, data: result, loading: false });
    } catch (err: any) {
      setDrilldown(null);
      setError(err.message);
    }
  }

  async function downloadPdf() {
    setDownloadingPdf(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (buildingFilter) params.set("building_id", buildingFilter);
      await downloadFile(`/reports/income-by-head/pdf?${params.toString()}`, `receipts-by-head_${dateFrom}_to_${dateTo}.pdf`);
    } catch (err: any) {
      setError(err.message || "Couldn't download the PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function runBackfill() {
    setBackfilling(true);
    setBackfillMessage(null);
    try {
      const result = await api.post<{
        payments_processed: number;
        payments_already_allocated: number;
        payments_skipped_no_line_items: number;
      }>("/reports/income-by-head/backfill");
      setBackfillMessage(
        `Done — ${result.payments_processed} historical receipt(s) split by head just now (${result.payments_already_allocated} were already done).`
      );
      load();
    } catch (err: any) {
      setBackfillMessage(`Couldn't backfill — ${err.message}`);
    } finally {
      setBackfilling(false);
    }
  }

  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {embedded ? (
          <div />
        ) : (
          <div>
            <h1 className="text-2xl font-display font-semibold">Receipts by Head</h1>
            <p className="text-sm text-ink/55 mt-1">
              Cash and bank received against invoices (by income head), security deposits and advance / opening balance,
              the amount paid out against security, and what was settled from deposits at final settlement. Click any
              amount to see what is behind it.
            </p>
          </div>
        )}
        {!embedded && (
          <div className="flex flex-col items-end gap-1">
            <Button variant="ghost" onClick={() => window.print()} className="no-print">
              <Printer size={16} className="mr-1.5 inline" /> Print
            </Button>
            <span className="text-xs italic text-ink/55">Amounts in Rupees</span>
          </div>
        )}
      </div>

      <PrintHeader company={company} reportTitle="Receipts by Head" />
      <p className="hidden print:block text-xs text-ink/50">
        {dateFrom} to {dateTo}
        {buildingFilter ? ` — ${buildings.find((b) => b.id === buildingFilter)?.name ?? ""}` : ""}
      </p>

      <Card className="no-print">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="From">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <Field label="Building">
            <Select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
              <option value="">All buildings</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={load} disabled={loading} className="w-full">
              {loading ? "Loading…" : "Apply"}
            </Button>
            <Button variant="ghost" onClick={downloadPdf} disabled={downloadingPdf || !data?.rows.length} className="w-full">
              {downloadingPdf ? "Preparing…" : "PDF (landscape)"}
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {error}.</p>
        </Card>
      )}

      {data && !data.reconciliation.matches && (
        <Card className="border-brass/40 no-print">
          <p className="text-sm text-ink/70">
            <span className="font-medium text-brass-dark">Heads up:</span> this report does not match the cash and bank books
            for the same dates. Received: report {formatPkr(data.reconciliation.report_total)} vs books{" "}
            {formatPkr(data.reconciliation.books_total)} (difference {formatPkr(data.reconciliation.gap)}). Paid against
            security: report {formatPkr(data.reconciliation.paid_report)} vs books {formatPkr(data.reconciliation.paid_books)}{" "}
            (difference {formatPkr(data.reconciliation.paid_gap)}).
          </p>
          <ul className="mt-2 text-xs text-ink/60 space-y-0.5">
            {data.reconciliation.by_source.map((b) => (
              <li key={b.source}>
                {b.source}: books {formatPkr(b.books)} · report {formatPkr(b.report)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink/45 mt-2">{data.reconciliation.note}</p>
          {data.reconciliation.unsplit_invoice_receipts !== 0 && (
            <div className="mt-3 flex items-center gap-3">
              <Button variant="secondary" onClick={runBackfill} disabled={backfilling}>
                {backfilling ? "Backfilling…" : "Backfill historical receipts"}
              </Button>
              {backfillMessage && <p className="text-xs text-ink/55">{backfillMessage}</p>}
            </div>
          )}
        </Card>
      )}

      {data && data.reconciliation.matches && (
        <p className="text-xs text-stamp-green no-print">
          Matches the cash and bank books for these dates: received {formatPkr(data.reconciliation.books_total)}, paid
          against security {formatPkr(data.reconciliation.paid_books)}.
        </p>
      )}

      <Card>
        <h2 className="text-sm font-semibold mb-1">Part 1 — Cash and bank receipts</h2>
        <p className="text-xs text-ink/45 mb-3 no-print">
          Click any amount below to see exactly which receipt(s) — and which bank/cash account(s) — made it up.
        </p>
        <DataTable
          keyField="sr"
          rows={rows}
          emptyMessage="No cash or bank receipts in this period."
          columns={[
            { header: "Sr", accessor: (r) => r.sr },
            { header: "Tenant", accessor: (r) => <span className="font-medium">{r.tenant_name}</span> },
            { header: L("Apartment"), accessor: (r) => r.room_label },
            ...columns.map((c) => ({
              header: c,
              accessor: (r: IncomeByHeadRow) =>
                r.heads[c] ? (
                  <button
                    onClick={() => openCell(r, c)}
                    className="figures underline decoration-dotted decoration-ink/30 hover:decoration-ink hover:text-brass-dark no-print-underline"
                  >
                    {formatPkr(r.heads[c])}
                  </button>
                ) : (
                  <span className="text-ink/30">—</span>
                ),
              align: "right" as const,
            })),
            {
              header: "Total received",
              accessor: (r) => <span className="figures font-semibold">{formatPkr(r.total)}</span>,
              align: "right",
            },
            {
              header: "Paid against security",
              accessor: (r) =>
                r.paid_against_security ? (
                  <button
                    onClick={() => openCell(r, "Paid against security")}
                    className="figures underline decoration-dotted decoration-ink/30 hover:decoration-ink hover:text-brass-dark no-print-underline"
                  >
                    {formatPkr(r.paid_against_security)}
                  </button>
                ) : (
                  <span className="text-ink/30">—</span>
                ),
              align: "right",
            },
            {
              header: "Net",
              accessor: (r) => <span className="figures font-semibold">{formatPkr(r.net)}</span>,
              align: "right",
            },
          ]}
        />
        {rows.length > 0 && (
          <div className="flex flex-wrap justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
            {columns.map((c) => (
              <span key={c}>
                {c}: <span className="figures">{formatPkr(data?.totals[c] ?? 0)}</span>
              </span>
            ))}
            <span>
              Total received: <span className="figures">{formatPkr(data?.grand_total ?? 0)}</span>
            </span>
            <span>
              Paid against security: <span className="figures">{formatPkr(data?.paid_total ?? 0)}</span>
            </span>
            <span>
              Net: <span className="figures">{formatPkr(data?.net_total ?? 0)}</span>
            </span>
          </div>
        )}
      </Card>

      {data && data.settlement.rows.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold mb-1">Part 2 — Settled at final settlement (from security deposit, not cash)</h2>
          <p className="text-xs text-ink/45 mb-3">
            Dues and charges cleared out of the tenant&apos;s security deposit when the lease was closed. No cash or bank
            money moved for these except the refund paid. Deposit released = settled + refund paid.
          </p>
          <DataTable
            keyField="sr"
            rows={data.settlement.rows}
            emptyMessage="No final settlements in this period."
            columns={[
              { header: "Sr", accessor: (r) => r.sr },
              { header: "Tenant", accessor: (r) => <span className="font-medium">{r.tenant_name}</span> },
              { header: L("Apartment"), accessor: (r) => r.room_label },
              { header: "Date", accessor: (r) => r.settled_on },
              ...data.settlement.columns.map((c) => ({
                header: c,
                accessor: (r: SettlementRow) =>
                  r.heads[c] ? (
                    <button
                      onClick={() => openSettlementCell(r, c)}
                      className="figures underline decoration-dotted decoration-ink/30 hover:decoration-ink hover:text-brass-dark no-print-underline"
                    >
                      {formatPkr(r.heads[c])}
                    </button>
                  ) : (
                    <span className="text-ink/30">—</span>
                  ),
                align: "right" as const,
              })),
              { header: "Settled", accessor: (r) => <span className="figures font-semibold">{formatPkr(r.settled_total)}</span>, align: "right" },
              {
                header: "Refund paid",
                accessor: (r) =>
                  r.refund_paid ? (
                    <button
                      onClick={() => openSettlementCell(r, "Refund paid")}
                      className="figures underline decoration-dotted decoration-ink/30 hover:decoration-ink hover:text-brass-dark no-print-underline"
                      title={r.refund_account ?? undefined}
                    >
                      {formatPkr(r.refund_paid)}
                    </button>
                  ) : (
                    <span className="text-ink/30">—</span>
                  ),
                align: "right",
              },
              { header: "Deposit released", accessor: (r) => <span className="figures font-semibold">{formatPkr(r.deposit_released)}</span>, align: "right" },
            ]}
          />
          <div className="flex flex-wrap justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
            {data.settlement.columns.map((c) => (
              <span key={c}>
                {c}: <span className="figures">{formatPkr(data.settlement.totals[c] ?? 0)}</span>
              </span>
            ))}
            <span>
              Settled: <span className="figures">{formatPkr(data.settlement.settled_total)}</span>
            </span>
            <span>
              Refund paid: <span className="figures">{formatPkr(data.settlement.refund_total)}</span>
            </span>
            <span>
              Deposit released: <span className="figures">{formatPkr(data.settlement.deposit_released_total)}</span>
            </span>
          </div>
        </Card>
      )}

      <Modal
        open={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldown ? `${drilldown.label} — ${drilldown.row.tenant_name}` : "Receipts"}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            {drilldown?.row.room_label} — everything that makes up this amount.
          </p>
          {drilldown?.loading && <p className="text-sm text-ink/45">Loading…</p>}
          {drilldown?.data && (
            <>
              <div className="space-y-2">
                {drilldown.data.receipts.map((r) => (
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
                <span className="figures">{formatPkr(drilldown.data.total)}</span>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
