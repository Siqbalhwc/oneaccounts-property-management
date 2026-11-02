"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PrintHeader } from "@/components/ui/PrintHeader";
import { api, Building, Company, downloadFile } from "@/lib/api";
import { useLabels } from "@/lib/labels";
import { firstOfMonthYmd, todayYmd } from "@/lib/dates";

type ReportRow = {
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

type ReportResponse = {
  columns: string[];
  rows: ReportRow[];
  totals: Record<string, number>;
  grand_total: number;
  paid_total: number;
  net_total: number;
  reconciliation: {
    books_net: number;
    report_net: number;
    gap: number;
    matches: boolean;
    by_source: { source: string; amount: number }[];
    unsplit_invoice_receipts: number;
    note: string;
  };
};

type Receipt = {
  payment_id: string;
  invoice_id: string | null;
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

const PAID = "Paid against security";

// Whole rupees, no "Rs" on any figure (the card says "Amounts in Rupees"
// once, on its top border); negatives in brackets, as in a ledger.
function num(n: number) {
  const r = Math.round(Number(n || 0));
  return r < 0 ? `(${Math.abs(r).toLocaleString("en-PK")})` : r.toLocaleString("en-PK");
}

export default function ReceiptsByHeadReport({ embedded = false }: { embedded?: boolean }) {
  const { L } = useLabels();
  const [dateFrom, setDateFrom] = useState(firstOfMonthYmd());
  const [dateTo, setDateTo] = useState(todayYmd());
  const [buildingFilter, setBuildingFilter] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [company, setCompany] = useState<Company | null>(null);

  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  // A long name is shown on one line ending in "…"; clicking it opens the
  // full text (still on one line). Any other click closes it.
  useEffect(() => {
    const close = () => setExpanded(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (buildingFilter) params.set("building_id", buildingFilter);
    api
      .get<ReportResponse>(`/reports/income-by-head?${params.toString()}`)
      .then(setData)
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openCell(row: ReportRow, label: string) {
    if (label === PAID ? !row.paid_against_security : !row.heads[label]) return;
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

  // Tenant / apartment text: one line, "…" when it is longer, full text on click.
  function textCell(key: string, text: string, strong = false) {
    return (
      <td className="relative px-2.5 py-2.5 text-left align-middle max-w-[160px]">
        <button
          type="button"
          title="Click to see all"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(expanded === key ? null : key);
          }}
          className={`block w-full truncate text-left ${strong ? "font-medium" : ""}`}
        >
          {text}
        </button>
        {expanded === key && (
          <div className="no-print absolute left-2 top-full z-30 -mt-1 whitespace-nowrap rounded-card bg-ink px-3 py-1.5 text-xs text-paper shadow-shell">
            {text}
          </div>
        )}
      </td>
    );
  }

  function amountCell(row: ReportRow, label: string, value: number) {
    return (
      <td key={label} className="px-2.5 py-2.5 text-right align-middle figures whitespace-nowrap">
        {value ? (
          <button
            onClick={() => openCell(row, label)}
            className="underline decoration-dotted decoration-ink/30 hover:decoration-ink hover:text-brass-dark no-print-underline"
          >
            {num(value)}
          </button>
        ) : (
          <span className="text-ink/25">—</span>
        )}
      </td>
    );
  }

  const th = "px-2.5 py-2.5 text-right align-bottom text-[10.5px] font-semibold uppercase tracking-wider text-ink/60 leading-tight";
  const group = "px-2 pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-ledger border-b border-border";

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {embedded ? (
          <div />
        ) : (
          <div>
            <h1 className="text-2xl font-display font-semibold">Receipts by Head</h1>
            <p className="text-sm text-ink/55 mt-1">
              Cash and bank received by income head, security deposits and advances, and the security paid out. Click any
              amount to see what is behind it.
            </p>
          </div>
        )}
        {!embedded && (
          <Button variant="ghost" onClick={() => window.print()} className="no-print">
            <Printer size={16} className="mr-1.5 inline" /> Print
          </Button>
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
            <Button variant="ghost" onClick={downloadPdf} disabled={downloadingPdf || !rows.length} className="w-full">
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
            <span className="font-medium text-brass-dark">Heads up:</span> net cash in this report ({num(data.reconciliation.report_net)})
            does not match the cash and bank books for the same dates ({num(data.reconciliation.books_net)}) — difference{" "}
            {num(data.reconciliation.gap)}.
          </p>
          <ul className="mt-2 text-xs text-ink/60 space-y-0.5">
            {data.reconciliation.by_source.map((b) => (
              <li key={b.source}>
                {b.source}: {num(b.amount)}
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
          Net cash matches the cash and bank books for these dates: {num(data.reconciliation.books_net)}.
        </p>
      )}

      <div className="relative">
        <span className="absolute -top-2.5 right-5 z-10 bg-paper px-2 text-xs italic text-ink/60">Amounts in Rupees</span>
        <Card>
          <p className="text-xs text-ink/45 mb-3 no-print">
            Click any amount to see the receipts behind it. Click a long name to see all of it.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr>
                  <th colSpan={3} />
                  <th colSpan={columns.length + 1} className={group}>
                    Received (cash &amp; bank)
                  </th>
                  <th className={group}>Paid out</th>
                  <th className={group}>Cash</th>
                </tr>
                <tr className="border-b-2 border-ledger">
                  <th className={`${th} text-left w-9`}>Sr</th>
                  <th className={`${th} text-left`}>Tenant</th>
                  <th className={`${th} text-left`}>{L("Apartment")}</th>
                  {columns.map((c) => (
                    <th key={c} className={th}>
                      {c}
                    </th>
                  ))}
                  <th className={th}>Total received</th>
                  <th className={th}>{PAID}</th>
                  <th className={th}>Net cash</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 6} className="py-10 text-center text-sm text-ink/45">
                      {loading ? "Loading…" : "No cash or bank receipts in this period."}
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.sr} className={`border-b border-border/70 ${i % 2 === 1 ? "bg-ink/[0.025]" : ""}`}>
                    <td className="px-2.5 py-2.5 text-left text-ink/55 align-middle">{r.sr}</td>
                    {textCell(`${r.sr}-t`, r.tenant_name, true)}
                    {textCell(`${r.sr}-r`, r.room_label)}
                    {columns.map((c) => amountCell(r, c, r.heads[c]))}
                    <td className="px-2.5 py-2.5 text-right align-middle figures font-semibold whitespace-nowrap">{num(r.total)}</td>
                    {amountCell(r, PAID, r.paid_against_security)}
                    <td
                      className={`px-2.5 py-2.5 text-right align-middle figures font-semibold whitespace-nowrap ${
                        r.net < 0 ? "text-stamp-red" : ""
                      }`}
                    >
                      {num(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-brass bg-ink/[0.045] font-bold">
                    <td />
                    <td className="px-2.5 py-3 text-left">Total</td>
                    <td />
                    {columns.map((c) => (
                      <td key={c} className="px-2.5 py-3 text-right figures whitespace-nowrap">
                        {num(data?.totals[c] ?? 0)}
                      </td>
                    ))}
                    <td className="px-2.5 py-3 text-right figures whitespace-nowrap">{num(data?.grand_total ?? 0)}</td>
                    <td className="px-2.5 py-3 text-right figures whitespace-nowrap">{num(data?.paid_total ?? 0)}</td>
                    <td className="px-2.5 py-3 text-right figures whitespace-nowrap">{num(data?.net_total ?? 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      <Modal
        open={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldown ? `${drilldown.label} — ${drilldown.row.tenant_name}` : "Receipts"}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink/50">{drilldown?.row.room_label} — everything that makes up this amount.</p>
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
                    <span className="figures font-medium">{num(r.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border">
                <span>Total</span>
                <span className="figures">{num(drilldown.data.total)}</span>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
