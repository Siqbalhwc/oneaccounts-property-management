"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type BalanceSheetRow = {
  account_id: string | null;
  account_code: string;
  account_name: string;
  account_type: "asset" | "liability" | "equity";
  balance: number;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function BalanceSheetPage() {
  const [rows, setRows] = useState<BalanceSheetRow[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [buildingFilter, setBuildingFilter] = useState("");

  function load() {
    const params = new URLSearchParams({ as_of_date: asOfDate });
    if (buildingFilter) params.set("building_id", buildingFilter);
    api
      .get<BalanceSheetRow[]>(`/financials/balance-sheet?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    api.get<Building[]>("/buildings").then(setBuildings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOfDate, buildingFilter]);

  const assets = (rows ?? []).filter((r) => r.account_type === "asset");
  const liabilities = (rows ?? []).filter((r) => r.account_type === "liability");
  const equity = (rows ?? []).filter((r) => r.account_type === "equity");

  const totalAssets = assets.reduce((s, r) => s + Number(r.balance), 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + Number(r.balance), 0);
  const totalEquity = equity.reduce((s, r) => s + Number(r.balance), 0);
  const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

  function Section({ title, items, total }: { title: string; items: BalanceSheetRow[]; total: number }) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wider text-brass-dark font-semibold mb-2">{title}</p>
        <div className="space-y-1.5">
          {items.length === 0 && <p className="text-sm text-ink/40">—</p>}
          {items.map((r) => (
            <div key={r.account_id ?? r.account_code} className="flex justify-between text-sm">
              <span className="text-ink/70">
                {r.account_name}
                {r.account_id === null && <span className="text-ink/35 text-xs"> (computed)</span>}
              </span>
              <span className="figures">{formatPkr(r.balance)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-border">
            <span>Total {title.toLowerCase()}</span>
            <span className="figures">{formatPkr(total)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Balance sheet</h1>
        <p className="text-sm text-ink/55 mt-1">What the company owns, owes, and is worth, as of a date.</p>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Card>
          <Section title="Assets" items={assets} total={totalAssets} />
        </Card>
        <Card>
          <div className="space-y-6">
            <Section title="Liabilities" items={liabilities} total={totalLiabilities} />
            <Section title="Equity" items={equity} total={totalEquity} />
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row justify-between gap-2 text-sm">
          <div className="flex gap-6">
            <span>Total assets: <span className="figures font-semibold">{formatPkr(totalAssets)}</span></span>
            <span>Total liabilities + equity: <span className="figures font-semibold">{formatPkr(totalLiabilities + totalEquity)}</span></span>
          </div>
          <span className={balanced ? "text-stamp-green font-medium" : "text-stamp-red font-medium"}>
            {balanced ? "✓ Balances" : "⚠ Does not balance — please report this"}
          </span>
        </div>
        <p className="text-xs text-ink/40 mt-3">
          &quot;Retained Earnings (computed)&quot; is the running total of income minus expenses to date — not a
          posted entry, since there&apos;s no formal period-close step yet. This is standard for an interim balance sheet.
        </p>
      </Card>
    </div>
  );
}
