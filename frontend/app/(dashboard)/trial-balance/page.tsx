"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type TrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];
const TYPE_LABELS: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses",
};

// A row in the rendered table is either a section heading or an account row.
type TableRow =
  | { kind: "heading"; key: string; label: string }
  | { kind: "account"; key: string; row: TrialBalanceRow };

export default function TrialBalancePage() {
  const router = useRouter();
  const [rows, setRows] = useState<TrialBalanceRow[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [buildingFilter, setBuildingFilter] = useState("");

  function load() {
    const params = new URLSearchParams({ as_of_date: asOfDate });
    if (buildingFilter) params.set("building_id", buildingFilter);
    api
      .get<TrialBalanceRow[]>(`/financials/trial-balance?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    api.get<Building[]>("/buildings").then(setBuildings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOfDate, buildingFilter]);

  function openLedger(row: TrialBalanceRow) {
    router.push(`/ledger?account_id=${row.account_id}&date_to=${asOfDate}`);
  }

  // Build one flat list of heading + account rows, in the standard trial
  // balance order, so it renders as ONE continuous table (not separate
  // boxed cards per type) with Dr/Cr aligned consistently throughout.
  const tableRows: TableRow[] = [];
  for (const type of TYPE_ORDER) {
    const rowsOfType = (rows ?? []).filter((r) => r.account_type === type);
    if (rowsOfType.length === 0) continue;
    tableRows.push({ kind: "heading", key: `h-${type}`, label: TYPE_LABELS[type] });
    for (const r of rowsOfType) {
      tableRows.push({ kind: "account", key: r.account_id, row: r });
    }
  }

  const totalDebit = (rows ?? []).reduce((s, r) => s + Number(r.total_debit), 0);
  const totalCredit = (rows ?? []).reduce((s, r) => s + Number(r.total_credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Trial balance</h1>
        <p className="text-sm text-ink/55 mt-1">
          Every account&apos;s total movement as of a date — click any account to see its ledger.
        </p>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {error}.</p>
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="As of date">
            <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </Field>
          <Field label="Building">
            <Select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
              <option value="">All buildings</option>
              {buildings?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 text-xs border-b border-border">
              <th className="pb-2 font-medium">Account</th>
              <th className="pb-2 font-medium text-right">Dr</th>
              <th className="pb-2 font-medium text-right">Cr</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-ink/40">No account activity yet.</td>
              </tr>
            )}
            {tableRows.map((tr) =>
              tr.kind === "heading" ? (
                <tr key={tr.key}>
                  <td colSpan={3} className="pt-4 pb-1.5 text-xs uppercase tracking-wider text-brass-dark font-semibold">
                    {tr.label}
                  </td>
                </tr>
              ) : (
                <tr key={tr.key} className="border-t border-border/60">
                  <td className="py-1.5">
                    <button onClick={() => openLedger(tr.row)} className="text-left hover:underline">
                      {tr.row.account_code} · {tr.row.account_name}
                    </button>
                  </td>
                  <td className="py-1.5 text-right figures">{tr.row.total_debit ? formatPkr(tr.row.total_debit) : ""}</td>
                  <td className="py-1.5 text-right figures">{tr.row.total_credit ? formatPkr(tr.row.total_credit) : ""}</td>
                </tr>
              )
            )}
          </tbody>
          {tableRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-ink/20 font-semibold">
                <td className="pt-2">Total</td>
                <td className="pt-2 text-right figures">{formatPkr(totalDebit)}</td>
                <td className="pt-2 text-right figures">{formatPkr(totalCredit)}</td>
              </tr>
              <tr>
                <td colSpan={3} className={`pt-1 text-xs ${balanced ? "text-stamp-green" : "text-stamp-red"}`}>
                  {balanced ? "✓ Balances" : "⚠ Does not balance"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
    </div>
  );
}
