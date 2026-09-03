"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type JournalLine = {
  line_id: string;
  entry_date: string;
  source_type: string;
  description?: string;
  account_code: string;
  account_name: string;
  direction: "debit" | "credit";
  amount: number;
};

type Owner = { id: string; name: string };
type Tenant = { id: string; full_name: string };

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
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");

  function load() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (buildingFilter) params.set("building_id", buildingFilter);
    if (ownerFilter) params.set("owner_id", ownerFilter);
    if (tenantFilter) params.set("tenant_id", tenantFilter);
    if (sourceTypeFilter) params.set("source_type", sourceTypeFilter);
    api
      .get<JournalLine[]>(`/financials/journal?${params.toString()}`)
      .then(setLines)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, buildingFilter, ownerFilter, tenantFilter, sourceTypeFilter]);

  useEffect(() => {
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Owner[]>("/owners").then(setOwners);
    api.get<Tenant[]>("/tenants").then(setTenants);
  }, []);

  const activeFilterCount = [buildingFilter, ownerFilter, tenantFilter, sourceTypeFilter].filter(Boolean).length;
  const totalDebits = (lines ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);
  const totalCredits = (lines ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Journal entries</h1>
          <p className="text-sm text-ink/55 mt-1">Every line posted to the ledger.</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="text-sm text-ledger hover:underline whitespace-nowrap"
          >
            {showFilters ? "Hide filters" : `Filter${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
          </button>
          <Link href="/journal/new">
            <Button>New entry</Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {error}.</p>
        </Card>
      )}

      {showFilters && (
        <Card>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Owner">
              <Select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                <option value="">All owners</option>
                {owners?.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tenant">
              <Select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
                <option value="">All tenants</option>
                {tenants?.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={sourceTypeFilter} onChange={(e) => setSourceTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {SOURCE_TYPES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      <Card>
        <DataTable
          keyField="line_id"
          rows={lines ?? []}
          emptyMessage="No journal lines match these filters."
          columns={[
            { header: "Date", accessor: (l) => l.entry_date },
            { header: "Description", accessor: (l) => l.description ?? "—" },
            { header: "Account", accessor: (l) => `${l.account_code} · ${l.account_name}` },
            { header: "Dr", accessor: (l) => (l.direction === "debit" ? <span className="figures">{formatPkr(l.amount)}</span> : ""), align: "right" },
            { header: "Cr", accessor: (l) => (l.direction === "credit" ? <span className="figures">{formatPkr(l.amount)}</span> : ""), align: "right" },
          ]}
        />
        {lines && lines.length > 0 && (
          <div className="flex justify-end gap-6 pt-3 mt-3 border-t border-border text-sm font-medium">
            <span>Total Dr: <span className="figures">{formatPkr(totalDebits)}</span></span>
            <span>Total Cr: <span className="figures">{formatPkr(totalCredits)}</span></span>
          </div>
        )}
      </Card>
    </div>
  );
}
