"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PrintHeader } from "@/components/ui/PrintHeader";
import { api, Building, Company } from "@/lib/api";

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

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function IncomeByHeadPage() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(firstOfMonth(today));
  const [dateTo, setDateTo] = useState(today.toISOString().slice(0, 10));
  const [buildingFilter, setBuildingFilter] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [company, setCompany] = useState<Company | null>(null);

  const [data, setData] = useState<IncomeByHeadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const [drilldown, setDrilldown] = useState<{
    row: IncomeByHeadRow;
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
    if (!row.heads[label]) return;
    setDrilldown({ row, label, data: null, loading: true });
    const params = new URLSearchParams({ label, date_from: dateFrom, date_to: dateTo });
    if (row.lease_id) params.set("lease_id", row.lease_id);
    else if (row.tenant_id) params.set("tenant_id", row.tenant_id);
    try {
      const result = await api.get<DrilldownResponse>(`/reports/income-by-head/drilldown?${params.toString()}`);
      setDrilldown({ row, label, data: result, loading: false });
    } catch (err: any) {
      setDrilldown(null);
      setError(err.message);
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
        <div>
          <h1 className="text-2xl font-display font-semibold">Receipts by Head</h1>
          <p className="text-sm text-ink/55 mt-1">
            What was actually collected (cash/bank) against each income head on tenants&apos; invoices —
            click any amount to see the receipt(s) behind it.
          </p>
        </div>
        <Button variant="ghost" onClick={() => window.print()} className="no-print">
          <Printer size={16} className="mr-1.5 inline" /> Print
        </Button>
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
          <div className="flex items-end">
            <Button variant="secondary" onClick={load} disabled={loading} className="w-full">
              {loading ? "Loading…" : "Apply"}
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
            <span className="font-medium text-brass-dark">Heads up:</span> allocated total (
            {formatPkr(data.reconciliation.allocated_total)}) doesn&apos;t yet match invoice-tied cash
            receipts for this period ({formatPkr(data.reconciliation.invoice_tied_cash_receipts_total)}).
            This almost always means some receipts were recorded before this report existed and haven&apos;t
            been split by head yet.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button variant="secondary" onClick={runBackfill} disabled={backfilling}>
              {backfilling ? "Backfilling…" : "Backfill historical receipts"}
            </Button>
            {backfillMessage && <p className="text-xs text-ink/55">{backfillMessage}</p>}
          </div>
        </Card>
      )}

      <Card>
        <p className="text-xs text-ink/45 mb-3 no-print">
          Click any amount below to see exactly which receipt(s) — and which bank/cash account(s) — made it up.
        </p>
        <DataTable
          keyField="sr"
          rows={rows}
          emptyMessage="No receipts recorded against any invoice in this period."
          columns={[
            { header: "Sr", accessor: (r) => r.sr },
            { header: "Tenant", accessor: (r) => <span className="font-medium">{r.tenant_name}</span> },
            { header: "Room / Apartment", accessor: (r) => r.room_label },
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
              header: "Total",
              accessor: (r) => <span className="figures font-semibold">{formatPkr(r.total)}</span>,
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
              Grand total: <span className="figures">{formatPkr(data?.grand_total ?? 0)}</span>
            </span>
          </div>
        )}
      </Card>

      <Modal
        open={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldown ? `${drilldown.label} — ${drilldown.row.tenant_name}` : "Receipts"}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            {drilldown?.row.room_label} — every bank/cash receipt that makes up this amount.
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
