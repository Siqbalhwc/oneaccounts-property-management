"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
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

type LedgerRow = {
  entry_date: string;
  description?: string;
  source_type: string;
  direction: "debit" | "credit";
  amount: number;
  building_name?: string;
  room_number?: string;
  owner_name?: string;
  tenant_name?: string;
  running_balance: number;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];
const TYPE_LABELS: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses",
};

export default function TrialBalancePage() {
  const [rows, setRows] = useState<TrialBalanceRow[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [buildingFilter, setBuildingFilter] = useState("");

  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerAccount, setLedgerAccount] = useState<TrialBalanceRow | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

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

  async function openLedger(row: TrialBalanceRow) {
    setLedgerAccount(row);
    setLedgerError(null);
    setLedgerRows(null);
    setLedgerOpen(true);
    try {
      const result = await api.get<LedgerRow[]>(`/financials/general-ledger/${row.account_id}?date_to=${asOfDate}`);
      setLedgerRows(result);
    } catch (err: any) {
      setLedgerError(err.message);
    }
  }

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    rows: (rows ?? []).filter((r) => r.account_type === type),
  })).filter((g) => g.rows.length > 0);

  const totalDebit = (rows ?? []).reduce((s, r) => s + Number(r.total_debit), 0);
  const totalCredit = (rows ?? []).reduce((s, r) => s + Number(r.total_credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Trial balance</h1>
        <p className="text-sm text-ink/55 mt-1">
          Every account&apos;s total movement as of a date — click any account to see its full ledger.
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
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {grouped.map((group) => (
        <Card key={group.type} title={group.label}>
          <DataTable
            keyField="account_id"
            rows={group.rows}
            emptyMessage=""
            columns={[
              {
                header: "Account",
                accessor: (r) => (
                  <button onClick={() => openLedger(r)} className="text-left hover:underline">
                    {r.account_code} · {r.account_name}
                  </button>
                ),
              },
              { header: "Debit", accessor: (r) => <span className="figures">{formatPkr(r.total_debit)}</span>, align: "right" },
              { header: "Credit", accessor: (r) => <span className="figures">{formatPkr(r.total_credit)}</span>, align: "right" },
            ]}
          />
        </Card>
      ))}

      {rows && rows.length > 0 && (
        <Card>
          <div className="flex justify-end gap-6 text-sm font-medium">
            <span>Total debits: <span className="figures">{formatPkr(totalDebit)}</span></span>
            <span>Total credits: <span className="figures">{formatPkr(totalCredit)}</span></span>
            <span className={balanced ? "text-stamp-green" : "text-stamp-red"}>
              {balanced ? "✓ Balances" : "⚠ Does not balance"}
            </span>
          </div>
        </Card>
      )}

      <Modal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        title={ledgerAccount ? `${ledgerAccount.account_code} · ${ledgerAccount.account_name}` : "Ledger"}
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {ledgerError && <p className="text-sm text-stamp-red">{ledgerError}</p>}
          {!ledgerError && ledgerRows === null && <p className="text-sm text-ink/40">Loading…</p>}
          {ledgerRows && ledgerRows.length === 0 && <p className="text-sm text-ink/40">No activity on this account.</p>}
          {ledgerRows && ledgerRows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/50 text-xs">
                  <th className="pb-1">Date</th>
                  <th className="pb-1">Description</th>
                  <th className="pb-1">Tags</th>
                  <th className="pb-1 text-right">Debit</th>
                  <th className="pb-1 text-right">Credit</th>
                  <th className="pb-1 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1.5 whitespace-nowrap">{l.entry_date}</td>
                    <td className="py-1.5">{l.description ?? "—"}</td>
                    <td className="py-1.5 text-xs text-ink/50">
                      {[l.building_name, l.room_number, l.owner_name, l.tenant_name].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-1.5 text-right figures">{l.direction === "debit" ? formatPkr(l.amount) : ""}</td>
                    <td className="py-1.5 text-right figures">{l.direction === "credit" ? formatPkr(l.amount) : ""}</td>
                    <td className="py-1.5 text-right figures font-medium">{formatPkr(l.running_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>
    </div>
  );
}
