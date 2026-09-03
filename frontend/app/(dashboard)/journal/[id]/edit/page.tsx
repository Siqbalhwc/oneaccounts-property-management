"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, AmountInput } from "@/components/ui/Field";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { api, Building, Tenant, Account } from "@/lib/api";

// Same local-extension pattern as journal/new/page.tsx and owners/page.tsx.
type BuildingWithOwner = Building & { owner_id?: string | null };
type RoomWithOwner = {
  id: string;
  building_id: string;
  room_number: string;
  owner_id?: string | null;
};
type Owner = { id: string; name: string };

type EntryLine = {
  account_id: string;
  debit: string;
  credit: string;
  building_id: string;
  room_id: string;
  owner_id: string;
  tenant_id: string;
};

type ManualEntryLine = {
  account_id: string;
  direction: "debit" | "credit";
  amount: number;
  building_id?: string | null;
  room_id?: string | null;
  owner_id?: string | null;
  tenant_id?: string | null;
};

type ManualEntry = {
  id: string;
  entry_date: string;
  description: string | null;
  source_type: string;
  source_id: string | null;
  status: string;
  lines: ManualEntryLine[];
};

function lineFromApi(l: ManualEntryLine): EntryLine {
  return {
    account_id: l.account_id,
    debit: l.direction === "debit" ? String(l.amount) : "",
    credit: l.direction === "credit" ? String(l.amount) : "",
    building_id: l.building_id ?? "",
    room_id: l.room_id ?? "",
    owner_id: l.owner_id ?? "",
    tenant_id: l.tenant_id ?? "",
  };
}

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function EditJournalEntryPage() {
  const router = useRouter();
  const params = useParams();
  const entryId = params.id as string;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [buildings, setBuildings] = useState<BuildingWithOwner[]>([]);
  const [rooms, setRooms] = useState<RoomWithOwner[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
    api.get<BuildingWithOwner[]>("/buildings").then(setBuildings);
    api.get<RoomWithOwner[]>("/rooms").then(setRooms);
    api.get<Owner[]>("/owners").then(setOwners);
    api.get<Tenant[]>("/tenants").then(setTenants);
  }, []);

  useEffect(() => {
    if (!entryId) return;
    api
      .get<ManualEntry>(`/ledger/manual-entry/${entryId}`)
      .then((entry) => {
        setEntryDate(entry.entry_date);
        setDescription(entry.description ?? "");
        setLines(entry.lines.map(lineFromApi));
      })
      .catch((err: any) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [entryId]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    [accounts]
  );
  const tenantOptions = useMemo(
    () => [{ value: "", label: "—" }, ...tenants.map((t) => ({ value: t.id, label: t.full_name }))],
    [tenants]
  );
  const ownerOptions = useMemo(
    () => [{ value: "", label: "—" }, ...owners.map((o) => ({ value: o.id, label: o.name }))],
    [owners]
  );
  const buildingOptions = useMemo(
    () => [{ value: "", label: "—" }, ...buildings.map((b) => ({ value: b.id, label: b.name }))],
    [buildings]
  );

  function updateLine(index: number, patch: Partial<EntryLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function updateDebit(index: number, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, debit: value, credit: value ? "" : l.credit } : l))
    );
  }
  function updateCredit(index: number, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, credit: value, debit: value ? "" : l.debit } : l))
    );
  }
  function handleBuildingChange(index: number, buildingId: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, building_id: buildingId, room_id: "", owner_id: "" } : l))
    );
  }
  function handleRoomChange(index: number, roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    const building = room ? buildings.find((b) => b.id === room.building_id) : null;
    const resolvedOwner = room?.owner_id || building?.owner_id || "";
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, room_id: roomId, owner_id: resolvedOwner || l.owner_id } : l))
    );
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { account_id: "", debit: "", credit: "", building_id: "", room_id: "", owner_id: "", tenant_id: "" },
    ]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  const isBalanced = lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const linesFilled = lines.every((l) => {
    const d = parseFloat(l.debit) || 0;
    const c = parseFloat(l.credit) || 0;
    return !!l.account_id && ((d > 0 && c === 0) || (c > 0 && d === 0));
  });

  const canSubmit = !!entryDate && !!description.trim() && linesFilled && isBalanced && !submitting;

  function roomOptionsFor(buildingId: string) {
    return [
      { value: "", label: "—" },
      ...rooms.filter((r) => r.building_id === buildingId).map((r) => ({ value: r.id, label: r.room_number })),
    ];
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/ledger/manual-entry/${entryId}`, {
        entry_date: entryDate,
        description: description.trim(),
        lines: lines.map((l) => {
          const d = parseFloat(l.debit) || 0;
          const c = parseFloat(l.credit) || 0;
          const direction: "debit" | "credit" = d > 0 ? "debit" : "credit";
          const amount = d > 0 ? d : c;
          return {
            account_id: l.account_id,
            direction,
            amount,
            building_id: l.building_id || undefined,
            room_id: l.room_id || undefined,
            owner_id: l.owner_id || undefined,
            tenant_id: l.tenant_id || undefined,
          };
        }),
      });
      router.push("/journal");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink/40">Loading…</p>;
  }

  if (loadError) {
    return (
      <Card className="border-stamp-red/40 max-w-2xl">
        <p className="text-sm text-stamp-red">
          Couldn&apos;t open this entry — {loadError}. It may not be a manually-created
          entry (only entries posted via &quot;New journal entry&quot; can be edited here).
        </p>
      </Card>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div>
        <button onClick={() => router.push("/journal")} className="text-sm text-ledger hover:underline mb-2">
          ← Back
        </button>
        <h1 className="text-2xl font-display font-semibold">Edit journal entry</h1>
        <p className="text-sm text-ink/55 mt-1 max-w-3xl">
          Only manually-created entries can be edited this way. Every change is
          recorded below, with who made it and when.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 max-w-2xl">
            <Field label="Date">
              <Input type="date" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </Field>
            <Field label="Reference / memo" hint="A short, clear summary — this is what shows in the journal list.">
              <Input
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">Lines</p>
            <p className="text-xs text-ink/50">Debits must equal credits before this can be saved.</p>
          </div>

          <div className="overflow-x-auto scrollbar-brass border border-border rounded-card">
            <table className="w-full min-w-[980px] text-sm border-collapse">
              <thead>
                <tr className="bg-ledger/5 border-b border-border">
                  <th className="sticky left-0 z-10 bg-paper text-left text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 pl-3 pr-2 whitespace-nowrap">
                    Account
                  </th>
                  <th className="text-right text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 px-2 whitespace-nowrap min-w-[110px]">
                    Debit
                  </th>
                  <th className="text-right text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 px-2 whitespace-nowrap min-w-[110px]">
                    Credit
                  </th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 px-2 whitespace-nowrap min-w-[130px]">
                    Tenant
                  </th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 px-2 whitespace-nowrap min-w-[130px]">
                    Owner
                  </th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 px-2 whitespace-nowrap min-w-[110px]">
                    Room
                  </th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-ink/50 py-2.5 px-2 whitespace-nowrap min-w-[150px]">
                    Building
                  </th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0 hover:bg-ledger/[0.02]">
                    <td className="sticky left-0 z-10 bg-paper-card shadow-[2px_0_0_rgba(31,45,36,0.04)] py-2 pl-3 pr-2 align-middle min-w-[210px]">
                      <SearchableSelect
                        value={line.account_id}
                        onChange={(v) => updateLine(i, { account_id: v })}
                        options={accountOptions}
                        placeholder="Search account…"
                        emptyLabel="No accounts match"
                      />
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <AmountInput
                        value={line.debit}
                        onChange={(e) => updateDebit(i, e.target.value)}
                        placeholder="0"
                        className="text-right"
                      />
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <AmountInput
                        value={line.credit}
                        onChange={(e) => updateCredit(i, e.target.value)}
                        placeholder="0"
                        className="text-right"
                      />
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <SearchableSelect
                        value={line.tenant_id}
                        onChange={(v) => updateLine(i, { tenant_id: v })}
                        options={tenantOptions}
                        placeholder="Search tenant…"
                        emptyLabel="No tenants match"
                      />
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <SearchableSelect
                        value={line.owner_id}
                        onChange={(v) => updateLine(i, { owner_id: v })}
                        options={ownerOptions}
                        placeholder="Search owner…"
                        emptyLabel="No owners match"
                      />
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <SearchableSelect
                        value={line.room_id}
                        onChange={(v) => handleRoomChange(i, v)}
                        options={roomOptionsFor(line.building_id)}
                        placeholder="Search room…"
                        disabled={!line.building_id}
                        emptyLabel="No rooms match"
                      />
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <SearchableSelect
                        value={line.building_id}
                        onChange={(v) => handleBuildingChange(i, v)}
                        options={buildingOptions}
                        placeholder="Search building…"
                        emptyLabel="No buildings match"
                      />
                    </td>
                    <td className="py-2 pr-3 align-middle">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={lines.length <= 2}
                        title="Remove line"
                        className="text-ink/35 hover:text-stamp-red disabled:opacity-30 disabled:cursor-not-allowed px-1 text-base leading-none"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={8} className="py-2.5 pl-3">
                    <button type="button" onClick={addLine} className="text-sm font-medium text-ledger hover:underline">
                      + Add a line
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky left-0 z-10 bg-paper-card ledger-rule pt-3 pl-3 pr-2 font-semibold text-ink/65 text-sm">
                    Total
                  </td>
                  <td className="border-t-2 border-rule pt-3 px-2 text-right font-semibold figures">
                    {formatPkr(totalDebit)}
                  </td>
                  <td className="border-t-2 border-rule pt-3 px-2 text-right font-semibold figures">
                    {formatPkr(totalCredit)}
                  </td>
                  <td className="border-t-2 border-rule" colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {(totalDebit > 0 || totalCredit > 0) && (
            <div
              className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card px-3.5 py-2.5 text-sm ${
                isBalanced
                  ? "bg-ledger/5 border border-ledger/20 text-ledger"
                  : "bg-stamp-red/10 border border-stamp-red/30 text-stamp-red"
              }`}
            >
              <span>{isBalanced ? "Balanced — debits equal credits." : "Out of balance."}</span>
              <span className="figures">
                {formatPkr(totalDebit)} {isBalanced ? "=" : "≠"} {formatPkr(totalCredit)}
              </span>
            </div>
          )}
        </Card>

        {error && <p className="text-sm text-stamp-red">{error}</p>}

        <div className="flex justify-end gap-2 pb-4">
          <Button type="button" variant="ghost" onClick={() => router.push("/journal")}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>

        <Card>
          <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">History</p>
          <HistoryPanel tableName="journal_entries" recordId={entryId} />
        </Card>
      </form>
    </div>
  );
}
