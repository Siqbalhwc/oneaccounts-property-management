"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { PrintHeader } from "@/components/ui/PrintHeader";
import { api, fetchPdfBlob, Building, Company } from "@/lib/api";

type Account = { id: string; code: string; name: string; account_type?: string };
type Owner = { id: string; name: string };
type Tenant = { id: string; full_name: string };
type Room = { id: string; building_id: string; room_number: string };
type LedgerRow = {
  entry_date: string;
  description?: string;
  source_type?: string;
  source_id?: string | null;
  journal_entry_id?: string;
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
  const accountId = searchParams.get("account_id") ?? "";
  const ownerIdParam = searchParams.get("owner_id");

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState(searchParams.get("tenant_id") ?? "");
  const [buildingId, setBuildingId] = useState(searchParams.get("building_id") ?? "");
  const [roomId, setRoomId] = useState(searchParams.get("room_id") ?? "");
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") ?? "");

  function load() {
    if (!accountId) {
      setRows(null);
      return;
    }
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (ownerIdParam) params.set("owner_id", ownerIdParam);
    if (tenantId) params.set("tenant_id", tenantId);
    if (buildingId) params.set("building_id", buildingId);
    if (roomId) params.set("room_id", roomId);
    api
      .get<LedgerRow[]>(`/financials/general-ledger/${accountId}?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, ownerIdParam, tenantId, buildingId, roomId, dateFrom, dateTo]);

  useEffect(() => {
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Company>("/company/me").then(setCompany);
  }, []);

  useEffect(() => {
    if (ownerIdParam) {
      api.get<Owner[]>("/owners").then((owners) => {
        setOwner(owners.find((o) => o.id === ownerIdParam) ?? null);
      });
    }
  }, [ownerIdParam]);

  // Every filter change (account, tenant, building, apartment) is pushed
  // into the URL so the exact view is shareable/bookmarkable, same
  // pattern the tenant filter already used.
  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/ledger?${params.toString()}`);
  }

  function handleAccountChange(value: string) {
    updateParam("account_id", value);
  }
  function handleTenantChange(value: string) {
    setTenantId(value);
    updateParam("tenant_id", value);
  }
  function handleBuildingChange(value: string) {
    setBuildingId(value);
    setRoomId(""); // apartment list depends on building -- clear a stale selection
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("building_id", value);
    else params.delete("building_id");
    params.delete("room_id");
    router.replace(`/ledger?${params.toString()}`);
  }
  function handleRoomChange(value: string) {
    setRoomId(value);
    updateParam("room_id", value);
  }

  async function openSourceDocument(row: LedgerRow) {
    if (!row.source_type) return;
    const key = `${row.journal_entry_id ?? ""}-${row.source_id ?? ""}-${row.entry_date}`;
    setOpenError(null);
    setOpeningId(key);
    try {
      const params = new URLSearchParams({ source_type: row.source_type });
      if (row.source_id) params.set("source_id", row.source_id);
      if (row.journal_entry_id) params.set("journal_entry_id", row.journal_entry_id);
      const blob = await fetchPdfBlob(`/financials/source-document?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: any) {
      setOpenError(err.message || "Couldn't open the source document.");
    } finally {
      setOpeningId(null);
    }
  }

  const accountOptions = useMemo(
    () => (accounts ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    [accounts]
  );
  const account = (accounts ?? []).find((a) => a.id === accountId) ?? null;
  const roomsForBuilding = (rooms ?? []).filter((r) => !buildingId || r.building_id === buildingId);
  const selectedTenant = tenants.find((t) => t.id === tenantId);

  const totalDebit = (rows ?? []).filter((r) => r.direction === "debit").reduce((s, r) => s + Number(r.amount), 0);
  const totalCredit = (rows ?? []).filter((r) => r.direction === "credit").reduce((s, r) => s + Number(r.amount), 0);
  const closingBalance = rows && rows.length > 0 ? rows[rows.length - 1].running_balance : 0;
  const rowsWithKey = (rows ?? []).map((r, i) => ({ ...r, _key: i }));

  return (
    <div className="space-y-6">
      <PrintHeader company={company} reportTitle="General Ledger" />

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          {accountId && (
            <button onClick={() => router.back()} className="text-sm text-accent hover:underline mb-2 no-print">
              ← Back
            </button>
          )}
          <h1 className="text-2xl font-display font-semibold">General ledger</h1>
          <p className="text-sm text-ink/55 mt-1">
            Full movement on any account, in date order — click a figure to open its source document.
          </p>
          {/* Print-only summary, since the filter card itself is hidden when printing. */}
          <p className="hidden print:block text-sm font-medium mt-2">
            {account ? `${account.code} · ${account.name}` : ""}
            {owner && ` — ${owner.name}`}
            {selectedTenant && ` — ${selectedTenant.full_name}`}
            {buildingId && ` — ${buildings?.find((b) => b.id === buildingId)?.name ?? ""}`}
            {roomId && ` — Apt ${roomsForBuilding.find((r) => r.id === roomId)?.room_number ?? ""}`}
            {(dateFrom || dateTo) && ` — ${dateFrom || "start"} to ${dateTo || "today"}`}
          </p>
        </div>
        <div className="flex items-end gap-3 no-print">
          <div className="w-36">
            <Field label="From">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="To">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </div>
          <Button variant="secondary" onClick={() => window.print()} disabled={!accountId}>
            <Printer size={15} /> Print
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {error}.</p>
        </Card>
      )}
      {openError && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t open that document — {openError}.</p>
        </Card>
      )}

      <Card className="no-print">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="Account">
            <SearchableSelect
              value={accountId}
              onChange={handleAccountChange}
              options={accountOptions}
              placeholder="Search accounts…"
            />
          </Field>
          <Field label="Building">
            <Select value={buildingId} onChange={(e) => handleBuildingChange(e.target.value)}>
              <option value="">All buildings</option>
              {buildings?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Apartment">
            <Select value={roomId} onChange={(e) => handleRoomChange(e.target.value)} disabled={!buildingId}>
              <option value="">{buildingId ? "All apartments" : "Select a building first"}</option>
              {roomsForBuilding.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenant">
            <Select value={tenantId} onChange={(e) => handleTenantChange(e.target.value)}>
              <option value="">All tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {!accountId ? (
        <Card>
          <p className="text-sm text-ink/50">Pick an account above to see its ledger.</p>
        </Card>
      ) : (
        <Card>
          <div className="mb-3">
            <h2 className="text-sm font-semibold">
              {account ? `${account.code} · ${account.name}` : "Ledger"}
              {owner && <span className="text-ink/50 font-normal"> — {owner.name}</span>}
              {selectedTenant && <span className="text-ink/50 font-normal"> — {selectedTenant.full_name}</span>}
            </h2>
          </div>
          <DataTable
            keyField="_key"
            rows={rowsWithKey}
            emptyMessage="No activity on this account for this period."
            columns={[
              { header: "Date", accessor: (r) => r.entry_date },
              { header: "Description", accessor: (r) => r.description ?? "—" },
              {
                header: "Dr",
                accessor: (r) =>
                  r.direction === "debit" ? (
                    <button
                      onClick={() => openSourceDocument(r)}
                      disabled={openingId !== null || !r.source_type}
                      className="figures hover:underline hover:text-accent disabled:no-underline disabled:cursor-default"
                      title="Open source document"
                    >
                      {formatPkr(r.amount)}
                    </button>
                  ) : (
                    ""
                  ),
                align: "right",
              },
              {
                header: "Cr",
                accessor: (r) =>
                  r.direction === "credit" ? (
                    <button
                      onClick={() => openSourceDocument(r)}
                      disabled={openingId !== null || !r.source_type}
                      className="figures hover:underline hover:text-accent disabled:no-underline disabled:cursor-default"
                      title="Open source document"
                    >
                      {formatPkr(r.amount)}
                    </button>
                  ) : (
                    ""
                  ),
                align: "right",
              },
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
      )}
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
