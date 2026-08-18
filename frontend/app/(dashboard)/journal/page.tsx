"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type JournalLine = {
  line_id: string;
  entry_id: string;
  entry_date: string;
  source_type: string;
  source_id: string;
  description?: string;
  account_code: string;
  account_name: string;
  account_type: string;
  direction: "debit" | "credit";
  amount: number;
  building_name?: string;
  room_number?: string;
  owner_name?: string;
  tenant_name?: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

const SOURCE_TYPES = [
  "invoice", "payment", "expense", "owner_payout", "salary_payment",
  "security_deposit", "security_deposit_refund",
];

export default function JournalEntriesPage() {
  const [lines, setLines] = useState<JournalLine[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");

  function load() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (buildingFilter) params.set("building_id", buildingFilter);
    if (sourceTypeFilter) params.set("source_type", sourceTypeFilter);
    api
      .get<JournalLine[]>(`/financials/journal?${params.toString()}`)
      .then(setLines)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    api.get<Building[]>("/buildings").then(setBuildings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, buildingFilter, sourceTypeFilter]);

  const totalDebits = (lines ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);
  const totalCredits = (lines ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Journal entries</h1>
        <p className="text-sm text-ink/55 mt-1">
          Every line posted to the ledger, tagged by building/room/owner/tenant.
        </p>
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
          <Field label="Source">
            <Select value={sourceTypeFilter} onChange={(e) => setSourceTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <DataTable
          keyField="line_id"
          rows={lines ?? []}
          emptyMessage="No journal lines match these filters."
          columns={[
            { header: "Date", accessor: (l) => l.entry_date },
            { header: "Description", accessor: (l) => l.description ?? "—" },
            { header: "Account", accessor: (l) => <span className="text-xs">{l.account_code} · {l.account_name}</span> },
            { header: "Building / Room", accessor: (l) => [l.building_name, l.room_number].filter(Boolean).join(" / ") || "—" },
            { header: "Owner", accessor: (l) => l.owner_name ?? "—" },
            { header: "Tenant", accessor: (l) => l.tenant_name ?? "—" },
            {
              header: "Debit",
              accessor: (l) => (l.direction === "debit" ? <span className="figures">{formatPkr(l.amount)}</span> : ""),
              align: "right",
            },
            {
              header: "Credit",
              accessor: (l) => (l.direction === "credit" ? <span className="figures">{formatPkr(l.amount)}</span> : ""),
              align: "right",
            },
          ]}
        />
        {lines && lines.length > 0 && (
          <div className="flex justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
            <span>Total debits: <span className="figures">{formatPkr(totalDebits)}</span></span>
            <span>Total credits: <span className="figures">{formatPkr(totalCredits)}</span></span>
            {Math.abs(totalDebits - totalCredits) > 0.01 && (
              <span className="text-stamp-red">⚠ Doesn&apos;t balance — check filters or contact support.</span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
