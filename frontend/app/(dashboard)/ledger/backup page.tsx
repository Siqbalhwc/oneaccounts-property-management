"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { api } from "@/lib/api";

type Account = { id: string; code: string; name: string };
type Owner = { id: string; name: string };
type LedgerRow = {
  entry_date: string;
  description?: string;
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

function LedgerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountId = searchParams.get("account_id");
  const ownerIdParam = searchParams.get("owner_id");

  const [account, setAccount] = useState<Account | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function load() {
    if (!accountId) return;
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (ownerIdParam) params.set("owner_id", ownerIdParam);
    api
      .get<LedgerRow[]>(`/financials/general-ledger/${accountId}?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, ownerIdParam, dateFrom, dateTo]);

  useEffect(() => {
    api.get<Account[]>("/chart-of-accounts").then((accounts) => {
      setAccount(accounts.find((a) => a.id === accountId) ?? null);
    });
    if (ownerIdParam) {
      api.get<Owner[]>("/owners").then((owners) => {
        setOwner(owners.find((o) => o.id === ownerIdParam) ?? null);
      });
    }
  }, [accountId, ownerIdParam]);

  const totalDebit = (rows ?? []).filter((r) => r.direction === "debit").reduce((s, r) => s + Number(r.amount), 0);
  const totalCredit = (rows ?? []).filter((r) => r.direction === "credit").reduce((s, r) => s + Number(r.amount), 0);
  const closingBalance = rows && rows.length > 0 ? rows[rows.length - 1].running_balance : 0;
  const rowsWithKey = (rows ?? []).map((r, i) => ({ ...r, _key: i }));

  if (!accountId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-semibold">Ledger</h1>
        <Card>
          <p className="text-sm text-ink/50">
            No account selected — open this from the Trial Balance or Owners page by clicking an account.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={() => router.back()} className="text-sm text-ledger hover:underline mb-2">
            ← Back
          </button>
          <h1 className="text-2xl font-display font-semibold">
            {account ? `${account.code} · ${account.name}` : "Ledger"}
            {owner && <span className="text-ink/50 font-normal"> — {owner.name}</span>}
          </h1>
          <p className="text-sm text-ink/55 mt-1">Full movement on this account, in date order.</p>
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
        </div>
      </Card>

      <Card>
        <DataTable
          keyField="_key"
          rows={rowsWithKey}
          emptyMessage="No activity on this account for this period."
          columns={[
            { header: "Date", accessor: (r) => r.entry_date },
            { header: "Description", accessor: (r) => r.description ?? "—" },
            { header: "Tags", accessor: (r) => [r.building_name, r.room_number, r.owner_name, r.tenant_name].filter(Boolean).join(" · ") || "—" },
            { header: "Dr", accessor: (r) => (r.direction === "debit" ? <span className="figures">{formatPkr(r.amount)}</span> : ""), align: "right" },
            { header: "Cr", accessor: (r) => (r.direction === "credit" ? <span className="figures">{formatPkr(r.amount)}</span> : ""), align: "right" },
            { header: "Balance", accessor: (r) => <span className="figures font-medium">{formatPkr(r.running_balance)}</span>, align: "right" },
          ]}
        />
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
            <span>Total Dr: <span className="figures">{formatPkr(totalDebit)}</span></span>
            <span>Total Cr: <span className="figures">{formatPkr(totalCredit)}</span></span>
            <span>Closing balance: <span className="figures">{formatPkr(closingBalance)}</span></span>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function LedgerPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink/40">Loading…</div>}>
      <LedgerPageInner />
    </Suspense>
  );
}
