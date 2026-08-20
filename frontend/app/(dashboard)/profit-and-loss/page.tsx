"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type PnlRow = {
  group_key: string;
  group_label: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: "income" | "expense";
  amount: number;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

type DrillLevel = { groupBy: "total" | "building" | "room" | "owner"; buildingId?: string; buildingLabel?: string };

export default function ProfitAndLossPage() {
  const [rows, setRows] = useState<PnlRow[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [drill, setDrill] = useState<DrillLevel>({ groupBy: "total" });

  function load() {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, group_by: drill.groupBy });
    if (drill.buildingId) params.set("building_id", drill.buildingId);
    api
      .get<PnlRow[]>(`/financials/profit-and-loss?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, drill]);

  useEffect(() => {
    api.get<Building[]>("/buildings").then(setBuildings);
  }, []);

  // Group rows by their drill-down group (building name, room number, or
  // owner name) so each renders as its own mini income statement.
  const groups = Array.from(new Set((rows ?? []).map((r) => r.group_key))).map((key) => {
    const groupRows = (rows ?? []).filter((r) => r.group_key === key);
    const label = groupRows[0]?.group_label ?? key;
    const income = groupRows.filter((r) => r.account_type === "income");
    const expense = groupRows.filter((r) => r.account_type === "expense");
    const totalIncome = income.reduce((s, r) => s + Number(r.amount), 0);
    const totalExpense = expense.reduce((s, r) => s + Number(r.amount), 0);
    return { key, label, income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
  });

  const grandTotalIncome = groups.reduce((s, g) => s + g.totalIncome, 0);
  const grandTotalExpense = groups.reduce((s, g) => s + g.totalExpense, 0);

  function drillIntoBuilding(buildingId: string, buildingLabel: string) {
    setDrill({ groupBy: "room", buildingId, buildingLabel });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Profit &amp; loss</h1>
        <p className="text-sm text-ink/55 mt-1">Income minus expenses for a period, drillable by building, room, or owner.</p>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {error}.</p>
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="From">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <Field label="View">
            <Select
              value={drill.groupBy}
              onChange={(e) => setDrill({ groupBy: e.target.value as DrillLevel["groupBy"] })}
            >
              <option value="total">Company total</option>
              <option value="building">By building</option>
              <option value="owner">By owner</option>
            </Select>
          </Field>
        </div>
        {drill.groupBy === "room" && drill.buildingLabel && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <button onClick={() => setDrill({ groupBy: "building" })} className="text-ledger hover:underline">
              ← Back to buildings
            </button>
            <span className="text-ink/40">/</span>
            <span className="text-ink/70">{drill.buildingLabel} — by room</span>
          </div>
        )}
      </Card>

      {groups.length === 0 && (
        <Card>
          <p className="text-sm text-ink/40 text-center py-8">No income or expense activity in this period.</p>
        </Card>
      )}

      {groups.map((g) => (
        <Card
          key={g.key}
          title={g.label}
          action={
            drill.groupBy === "building" ? (
              <Button variant="ghost" onClick={() => drillIntoBuilding(g.key, g.label)}>
                View rooms →
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-1.5">
            {g.income.length > 0 && (
              <>
                <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">Income</p>
                {g.income.map((r) => (
                  <div key={r.account_id} className="flex justify-between text-sm">
                    <span className="text-ink/70">{r.account_name}</span>
                    <span className="figures">{formatPkr(r.amount)}</span>
                  </div>
                ))}
              </>
            )}
            {g.expense.length > 0 && (
              <>
                <p className="text-xs uppercase tracking-wider text-ink/45 mt-3 mb-1">Expenses</p>
                {g.expense.map((r) => (
                  <div key={r.account_id} className="flex justify-between text-sm">
                    <span className="text-ink/70">{r.account_name}</span>
                    <span className="figures">{formatPkr(r.amount)}</span>
                  </div>
                ))}
              </>
            )}
            <div className="flex justify-between text-sm font-semibold pt-2 mt-2 border-t border-border">
              <span>Net</span>
              <span className={`figures ${g.net >= 0 ? "text-stamp-green" : "text-stamp-red"}`}>{formatPkr(g.net)}</span>
            </div>
          </div>
        </Card>
      ))}

      {groups.length > 1 && (
        <Card>
          <div className="flex justify-between text-sm font-semibold">
            <span>Grand total</span>
            <span className={`figures ${grandTotalIncome - grandTotalExpense >= 0 ? "text-stamp-green" : "text-stamp-red"}`}>
              {formatPkr(grandTotalIncome - grandTotalExpense)}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
