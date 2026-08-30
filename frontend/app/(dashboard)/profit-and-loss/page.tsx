"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building, Company } from "@/lib/api";

type PnlRow = {
  group_key: string;
  group_label: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: "income" | "expense";
  amount: number;
};

type Owner = { id: string; name: string; is_archived?: boolean };
type Column = { key: string; label: string };

function formatPkr(n: number) {
  return Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

type View = "total" | "building" | "owner";

export default function ProfitAndLossPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [rawRows, setRawRows] = useState<PnlRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [view, setView] = useState<View>("total");

  function load() {
    const groupBy = view === "total" ? "total" : view;
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, group_by: groupBy });
    api
      .get<PnlRow[]>(`/financials/profit-and-loss?${params.toString()}`)
      .then(setRawRows)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, view]);

  useEffect(() => {
    api.get<Company>("/company/me").then(setCompany);
    // include_archived=true on purpose -- a cost split made against a
    // building that's since been archived is still real money that
    // belongs somewhere. Without archived buildings/owners in this list,
    // that amount would only count toward the Total column with no
    // building column to actually show it under -- it would just look
    // like it vanished, not merely unlabeled.
    api.get<Building[]>("/buildings?include_archived=true").then(setBuildings);
    api.get<Owner[]>("/owners?include_archived=true").then(setOwners);
  }, []);

  // Columns depend on the view: Total has one "Total" column; By Building /
  // By Owner show every ACTIVE building/owner always (even with no data
  // this period, matching the original behaviour), PLUS a column for any
  // ARCHIVED building/owner that actually has an amount in this period
  // (labeled "(Archived)" so it's clear why it's not in the normal list),
  // PLUS "Unassigned" for anything genuinely never split at all, PLUS
  // Total on the right. Every rupee the API returns always lands in
  // exactly one of these columns -- nothing is ever silently dropped.
  const groupKeysWithData = new Set((rawRows ?? []).map((r) => r.group_key));
  function buildColumns(entities: { id: string; name: string; is_archived?: boolean }[]): Column[] {
    const active = entities.filter((e) => !e.is_archived).map((e) => ({ key: e.id, label: e.name }));
    const archivedWithData = entities
      .filter((e) => e.is_archived && groupKeysWithData.has(e.id))
      .map((e) => ({ key: e.id, label: `${e.name} (Archived)` }));
    const unassigned = groupKeysWithData.has("unassigned") && (rawRows ?? []).some((r) => r.group_key === "unassigned" && Number(r.amount) !== 0)
      ? [{ key: "unassigned", label: "Unassigned" }]
      : [];
    return [...active, ...archivedWithData, ...unassigned, { key: "total", label: "Total" }];
  }
  const columns: Column[] =
    view === "total" ? [{ key: "total", label: "Total" }] : view === "building" ? buildColumns(buildings) : buildColumns(owners);

  // Every account that appears anywhere in the result, in first-seen order
  // (the backend already orders by account_type then code), split into
  // income vs expense sections.
  const accountsSeen: { id: string; code: string; name: string; type: "income" | "expense" }[] = [];
  for (const r of rawRows ?? []) {
    if (!accountsSeen.some((a) => a.id === r.account_id)) {
      accountsSeen.push({ id: r.account_id, code: r.account_code, name: r.account_name, type: r.account_type });
    }
  }
  const incomeAccounts = accountsSeen.filter((a) => a.type === "income");
  const expenseAccounts = accountsSeen.filter((a) => a.type === "expense");

  // amount(accountId, columnKey) -- looks up the raw P&L result for a given
  // account + group; the rightmost "Total" column is always the sum across
  // the other columns, computed here rather than a second API call, so it
  // can never disagree with what's actually displayed.
  function amountFor(accountId: string, columnKey: string): number {
    if (columnKey === "total") {
      return (rawRows ?? []).filter((r) => r.account_id === accountId).reduce((s, r) => s + Number(r.amount), 0);
    }
    const row = (rawRows ?? []).find((r) => r.account_id === accountId && r.group_key === columnKey);
    return row ? Number(row.amount) : 0;
  }

  function sectionTotal(accounts: typeof accountsSeen, columnKey: string): number {
    return accounts.reduce((s, a) => s + amountFor(a.id, columnKey), 0);
  }

  const dateLabel = `${dateFrom} to ${dateTo}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Profit &amp; loss</h1>
          <p className="text-sm text-ink/55 mt-1">Income minus expenses for a period.</p>
        </div>
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
            <Select value={view} onChange={(e) => setView(e.target.value as View)}>
              <option value="total">Company Total</option>
              <option value="building">By Building</option>
              <option value="owner">By Owner</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <div className="text-center mb-4">
          <p className="font-display text-lg font-semibold">{company?.name || "One Accounts Properties"}</p>
          <p className="text-sm text-ink/60">Profit &amp; Loss</p>
          <p className="text-xs text-ink/40 mt-0.5">{dateLabel}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-2 font-medium text-ink/50 text-xs uppercase tracking-wide">Account</th>
                {columns.map((c) => (
                  <th key={c.key} className="text-right pb-2 font-medium text-ink/50 text-xs uppercase tracking-wide whitespace-nowrap pl-4">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pt-1 pb-1 font-semibold text-ink/80" colSpan={columns.length + 1}>Income</td>
              </tr>
              {incomeAccounts.map((a) => (
                <tr key={a.id} className="border-t border-border/50">
                  <td className="py-1.5 text-ink/70">{a.name}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="py-1.5 text-right figures pl-4">{formatPkr(amountFor(a.id, c.key))}</td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-ink/20 font-semibold">
                <td className="py-1.5">Total Income</td>
                {columns.map((c) => (
                  <td key={c.key} className="py-1.5 text-right figures pl-4">{formatPkr(sectionTotal(incomeAccounts, c.key))}</td>
                ))}
              </tr>

              <tr><td colSpan={columns.length + 1} className="h-4" /></tr>

              <tr>
                <td className="pb-1 font-semibold text-ink/80" colSpan={columns.length + 1}>Expenses</td>
              </tr>
              {expenseAccounts.map((a) => (
                <tr key={a.id} className="border-t border-border/50">
                  <td className="py-1.5 text-ink/70">{a.name}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="py-1.5 text-right figures pl-4">{formatPkr(amountFor(a.id, c.key))}</td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-ink/20 font-semibold">
                <td className="py-1.5">Total Expenses</td>
                {columns.map((c) => (
                  <td key={c.key} className="py-1.5 text-right figures pl-4">{formatPkr(sectionTotal(expenseAccounts, c.key))}</td>
                ))}
              </tr>

              <tr><td colSpan={columns.length + 1} className="h-4" /></tr>

              <tr className="border-t-2 border-ink/30 font-bold text-base">
                <td className="py-2">Net Profit</td>
                {columns.map((c) => {
                  const net = sectionTotal(incomeAccounts, c.key) - sectionTotal(expenseAccounts, c.key);
                  return (
                    <td key={c.key} className={`py-2 text-right figures pl-4 ${net >= 0 ? "text-stamp-green" : "text-stamp-red"}`}>
                      {formatPkr(net)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
