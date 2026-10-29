"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StampBadge } from "@/components/ui/StampBadge";
import { Field, Input, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";
import { useLabels } from "@/lib/labels";
import { firstOfMonthYmd, todayYmd } from "@/lib/dates";

type JournalLine = {
  line_id: string;
  entry_id: string;
  entry_date: string;
  source_type: string;
  source_id: string | null;
  description?: string;
  account_code: string;
  account_name: string;
  direction: "debit" | "credit";
  amount: number;
};

type Owner = { id: string; name: string };
type Tenant = { id: string; full_name: string };
type ManualEntry = {
  id: string;
  entry_date: string;
  description: string | null;
  status: string;
  total_amount: number;
  lines_summary: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

const SOURCE_TYPES = [
  "invoice", "payment", "expense", "owner_payout", "salary_payment",
  "security_deposit", "security_deposit_refund",
];

export default function JournalEntriesPage() {
  const { L } = useLabels();
  const [lines, setLines] = useState<JournalLine[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(propertySearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [propertySearch]);

  // Manual/adjustment entries only -- these are the only entries that can
  // ever be edited (vs. reversed), so they get their own small list with
  // an Edit action, separate from the all-lines table below which mixes
  // in every source type and isn't grouped by entry.
  const [manualEntries, setManualEntries] = useState<ManualEntry[] | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  function loadManualEntries() {
    const manualParams = new URLSearchParams();
    if (debouncedSearch) manualParams.set("property_search", debouncedSearch);
    const manualQuery = manualParams.toString();
    api
      .get<ManualEntry[]>(`/ledger/manual-entries${manualQuery ? `?${manualQuery}` : ""}`)
      .then(setManualEntries)
      .catch((err: any) => setManualError(err.message));
  }

  // Opens on this month, 1st to today; change or clear the dates to see more.
  const [dateFrom, setDateFrom] = useState(firstOfMonthYmd());
  const [dateTo, setDateTo] = useState(todayYmd());
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
    if (debouncedSearch) params.set("property_search", debouncedSearch);
    api
      .get<JournalLine[]>(`/financials/journal?${params.toString()}`)
      .then(setLines)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, buildingFilter, ownerFilter, tenantFilter, sourceTypeFilter, debouncedSearch]);

  useEffect(() => {
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Owner[]>("/owners").then(setOwners);
    api.get<Tenant[]>("/tenants").then(setTenants);
  }, []);

  useEffect(() => {
    loadManualEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

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
            className="text-sm text-accent hover:underline whitespace-nowrap"
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

      <Input
        value={propertySearch}
        onChange={(e) => setPropertySearch(e.target.value)}
        placeholder={L("Search by building or apartment (e.g. Sunrise 101)…")}
        className="max-w-sm no-print"
      />

      <p className="text-xs text-ink/50 -mt-3 no-print">
        {dateFrom || dateTo ? `Showing ${dateFrom || "the start"} to ${dateTo || "today"}.` : "Showing all dates."}{" "}
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => {
            setDateFrom("");
            setDateTo("");
          }}
        >
          Show all dates
        </button>
      </p>

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
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Manual entries</h2>
          <p className="text-xs text-ink/50 mt-0.5">
            Only entries posted here via &quot;New entry&quot; can be edited after posting.
            Everything else (leases, invoices, payments, expenses, salaries, deposits)
            must be corrected by reversing it instead.
          </p>
        </div>
        {manualError && <p className="text-sm text-stamp-red mb-2">Couldn&apos;t load manual entries — {manualError}.</p>}
        <DataTable
          keyField="id"
          rows={manualEntries ?? []}
          emptyMessage="No manual entries yet."
          columns={[
            { header: "Date", accessor: (e) => e.entry_date },
            { header: "Description", accessor: (e) => e.description ?? "—" },
            { header: "Lines", accessor: (e) => <span className="text-ink/60 text-xs">{e.lines_summary}</span> },
            { header: "Amount", accessor: (e) => <span className="figures">{formatPkr(e.total_amount)}</span>, align: "right" },
            { header: "Status", accessor: (e) => <StampBadge status={e.status === "reversed" ? "terminated" : "active"} /> },
            {
              header: "",
              accessor: (e) =>
                e.status === "reversed" ? (
                  <span className="text-xs text-ink/35">Reversed</span>
                ) : (
                  <Link href={`/journal/${e.id}/edit`} title="Edit" className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink inline-flex">
                    <Pencil size={16} />
                  </Link>
                ),
              align: "right",
            },
          ]}
        />
      </Card>

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
