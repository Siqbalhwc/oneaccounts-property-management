"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, AmountInput } from "@/components/ui/Field";
import { api, Building, Tenant, Account } from "@/lib/api";

// Room and Owner aren't fully typed in lib/api.ts (Room there predates
// per-room ownership, and there's no exported Owner type at all) --
// declared locally, same pattern buildings/page.tsx already uses.
type RoomWithOwner = {
  id: string;
  building_id: string;
  room_number: string;
  owner_id?: string | null;
};
type Owner = { id: string; name: string };

type EntryLine = {
  account_id: string;
  direction: "debit" | "credit";
  amount: string;
  building_id: string;
  room_id: string;
  owner_id: string;
  tenant_id: string;
};

function emptyLine(): EntryLine {
  return { account_id: "", direction: "debit", amount: "", building_id: "", room_id: "", owner_id: "", tenant_id: "" };
}

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function NewJournalEntryPage() {
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<RoomWithOwner[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([emptyLine(), emptyLine()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<RoomWithOwner[]>("/rooms").then(setRooms);
    api.get<Owner[]>("/owners").then(setOwners);
    api.get<Tenant[]>("/tenants").then(setTenants);
  }, []);

  function updateLine(index: number, patch: Partial<EntryLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  // Picking a building clears any room/owner that no longer makes sense;
  // picking a room auto-fills its resolved owner (room's own owner_id,
  // falling back to the building's) as a starting point -- still editable,
  // since the point of asking is to let the user correct it if needed.
  function handleBuildingChange(index: number, buildingId: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, building_id: buildingId, room_id: "", owner_id: "" } : l))
    );
  }

  function handleRoomChange(index: number, roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    const building = room ? buildings.find((b) => b.id === room.building_id) : null;
    const resolvedOwner = room?.owner_id || (building as any)?.owner_id || "";
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, room_id: roomId, owner_id: resolvedOwner || l.owner_id } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const totalDebit = lines
    .filter((l) => l.direction === "debit")
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const totalCredit = lines
    .filter((l) => l.direction === "credit")
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const isBalanced = lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;
  const linesFilled = lines.every((l) => l.account_id && l.amount && parseFloat(l.amount) > 0);
  const canSubmit = !!entryDate && !!description.trim() && linesFilled && isBalanced && !submitting;

  function roomsForBuilding(buildingId: string) {
    return rooms.filter((r) => r.building_id === buildingId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/ledger/manual-entry", {
        entry_date: entryDate,
        description: description.trim(),
        lines: lines.map((l) => ({
          account_id: l.account_id,
          direction: l.direction,
          amount: parseFloat(l.amount),
          building_id: l.building_id || undefined,
          room_id: l.room_id || undefined,
          owner_id: l.owner_id || undefined,
          tenant_id: l.tenant_id || undefined,
        })),
      });
      router.push("/journal");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <button onClick={() => router.back()} className="text-sm text-ledger hover:underline mb-2">
          ← Back
        </button>
        <h1 className="text-2xl font-display font-semibold">New journal entry</h1>
        <p className="text-sm text-ink/55 mt-1">
          For manual adjustments — corrections, write-offs, or anything else that
          doesn&apos;t come from an invoice, payment, expense, salary, or deposit action.
          Tag each line with building / room / owner so it shows up correctly in P&amp;L
          and owner reports.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date">
              <Input type="date" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </Field>
            <Field label="Description" hint="A short, clear summary — this is what shows in the journal list.">
              <Input
                required
                placeholder="e.g. Correction — overstated water charge for Room 204, July 2026"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium">Lines</p>
            <p className="text-xs text-ink/50">Debits must equal credits before this can be posted.</p>
          </div>

          <div className="space-y-3">
            {lines.map((line, i) => {
              const roomOptions = line.building_id ? roomsForBuilding(line.building_id) : [];
              return (
                <div key={i} className="border border-border rounded-card p-3 space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                    <div className="lg:col-span-4">
                      <Field label="Account">
                        <Select value={line.account_id} onChange={(e) => updateLine(i, { account_id: e.target.value })}>
                          <option value="">Select account…</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} · {a.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="lg:col-span-2">
                      <Field label="Dr / Cr">
                        <Select
                          value={line.direction}
                          onChange={(e) => updateLine(i, { direction: e.target.value as "debit" | "credit" })}
                        >
                          <option value="debit">Debit</option>
                          <option value="credit">Credit</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="lg:col-span-2">
                      <Field label="Amount">
                        <AmountInput value={line.amount} onChange={(e) => updateLine(i, { amount: e.target.value })} />
                      </Field>
                    </div>
                    <div className="lg:col-span-3">
                      <Field label="Tenant (optional)">
                        <Select value={line.tenant_id} onChange={(e) => updateLine(i, { tenant_id: e.target.value })}>
                          <option value="">—</option>
                          {tenants.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.full_name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="lg:col-span-1 flex lg:justify-end lg:pt-6">
                      <Button type="button" variant="ghost" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
                        Remove
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start pt-1 border-t border-border">
                    <div className="lg:col-span-4 pt-3">
                      <Field label="Property (building)" hint="Needed for building/owner-level P&L.">
                        <Select value={line.building_id} onChange={(e) => handleBuildingChange(i, e.target.value)}>
                          <option value="">— Company-wide, no property —</option>
                          {buildings.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="lg:col-span-4 pt-3">
                      <Field label="Room (optional)">
                        <Select
                          value={line.room_id}
                          onChange={(e) => handleRoomChange(i, e.target.value)}
                          disabled={!line.building_id}
                        >
                          <option value="">—</option>
                          {roomOptions.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.room_number}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="lg:col-span-4 pt-3">
                      <Field label="Owner" hint="Auto-filled from the room/building — override if this line belongs to a different owner.">
                        <Select value={line.owner_id} onChange={(e) => updateLine(i, { owner_id: e.target.value })}>
                          <option value="">—</option>
                          {owners.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="button" variant="secondary" onClick={addLine} className="mt-3">
            + Add another line
          </Button>

          <div className="ledger-rule pt-3 mt-4 flex flex-wrap justify-end gap-6 text-sm font-medium">
            <span>
              Total Dr: <span className="figures">{formatPkr(totalDebit)}</span>
            </span>
            <span>
              Total Cr: <span className="figures">{formatPkr(totalCredit)}</span>
            </span>
            {!isBalanced && (totalDebit > 0 || totalCredit > 0) && (
              <span className="text-stamp-red">Out of balance by {formatPkr(Math.abs(totalDebit - totalCredit))}</span>
            )}
          </div>
        </Card>

        {error && <p className="text-sm text-stamp-red">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.push("/journal")}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Posting…" : "Post entry"}
          </Button>
        </div>
      </form>
    </div>
  );
}
