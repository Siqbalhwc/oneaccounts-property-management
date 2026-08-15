"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Tenant, Room, Building } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, AmountInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

type Charge = { label: string; amount: string; recurrence: "recurring" | "one_time"; account_id: string };
type Account = { id: string; code: string; name: string; account_type: string; transfers_to_owner: boolean };
type ChargeMapping = { label: string; account_id: string };
type LeaseSummary = { tenant_id: string; status: string; room_id: string };

const STEPS = ["Tenant & room", "Rent structure", "Security deposit", "Review"] as const;

const DEFAULT_CHARGES: Charge[] = [
  { label: "Rent", amount: "", recurrence: "recurring", account_id: "" },
  { label: "Internet fee", amount: "", recurrence: "recurring", account_id: "" },
  { label: "Parking fee", amount: "", recurrence: "recurring", account_id: "" },
  { label: "Water bill", amount: "", recurrence: "recurring", account_id: "" },
];

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function NewLeasePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [chargeMappings, setChargeMappings] = useState<ChargeMapping[]>([]);
  const [existingLeases, setExistingLeases] = useState<LeaseSummary[]>([]);

  // Step 1
  const [tenantId, setTenantId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endDateTouched, setEndDateTouched] = useState(false);

  // Step 2
  const [charges, setCharges] = useState<Charge[]>(DEFAULT_CHARGES);

  // Step 3
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDate, setDepositDate] = useState("");

  useEffect(() => {
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
    api.get<ChargeMapping[]>("/chart-of-accounts/charge-mappings").then(setChargeMappings);
    api.get<LeaseSummary[]>("/leases").then(setExistingLeases);
  }, []);

  const vacantRooms = rooms.filter(
    (r) => r.building_id === buildingId && r.status === "vacant"
  );

  function oneYearLater(dateStr: string): string {
    const d = new Date(dateStr);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1); // e.g. 2026-08-14 -> 2027-08-13, a full year not year+1day
    return d.toISOString().slice(0, 10);
  }

  function handleStartDateChange(value: string) {
    setStartDate(value);
    if (!endDateTouched && value) {
      setEndDate(oneYearLater(value));
    }
  }

  const activeLeaseForTenant = tenantId
    ? existingLeases.find((l) => l.tenant_id === tenantId && l.status === "active")
    : null;
  const activeLeaseRoom = activeLeaseForTenant ? rooms.find((r) => r.id === activeLeaseForTenant.room_id) : null;

  const totalRent = charges.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const recurringTotal = charges.filter((c) => c.recurrence === "recurring").reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const oneTimeTotal = charges.filter((c) => c.recurrence === "one_time").reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

  function updateCharge(index: number, field: keyof Charge, value: string) {
    setCharges((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }

  function addCustomCharge() {
    setCharges((prev) => [...prev, { label: "", amount: "", recurrence: "recurring", account_id: "" }]);
  }

  // Once existing charge-label -> account mappings load, auto-fill any
  // charge row whose label already has a known mapping (e.g. "Rent" was
  // bound once before) so the user isn't asked to re-pick it every time.
  useEffect(() => {
    if (chargeMappings.length === 0) return;
    setCharges((prev) =>
      prev.map((c) => {
        if (c.account_id || !c.label) return c;
        const mapping = chargeMappings.find((m) => m.label.toLowerCase() === c.label.toLowerCase());
        return mapping ? { ...c, account_id: mapping.account_id } : c;
      })
    );
  }, [chargeMappings]);

  function removeCharge(index: number) {
    setCharges((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // Bind any new charge labels to their chosen account BEFORE creating
      // the lease, so future leases with the same label auto-fill it --
      // this is the "ask once, remember forever" flow.
      const newMappings = filledCharges.filter(
        (c) => !chargeMappings.some((m) => m.label.toLowerCase() === c.label.toLowerCase())
      );
      for (const c of newMappings) {
        await api.put("/chart-of-accounts/charge-mappings", { label: c.label, account_id: c.account_id });
      }

      await api.post("/leases", {
        tenant_id: tenantId,
        room_id: roomId,
        start_date: startDate,
        end_date: endDate,
        charges: filledCharges.map((c) => ({
          label: c.label,
          amount: parseFloat(c.amount),
          recurrence: c.recurrence,
        })),
        security_deposit_amount: parseFloat(depositAmount || "0"),
        security_deposit_date_received: depositDate || startDate,
      });
      router.push("/leases");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canProceedStep0 = tenantId && roomId && startDate && endDate && !activeLeaseForTenant;
  const filledCharges = charges.filter((c) => c.label && c.amount);
  const canProceedStep1 = filledCharges.length > 0 && filledCharges.every((c) => c.account_id);

  // Mirrors the backend's exact proration logic, purely for a preview here --
  // the real charge happens server-side when the first invoice is generated.
  function firstInvoicePreview(): { prorated: boolean; days: number; daysInMonth: number; total: number } | null {
    if (!startDate) return null;
    const start = new Date(startDate + "T00:00:00");
    if (start.getDate() === 1) return null; // starts on the 1st -- full month, nothing to preview
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const daysInMonth = monthEnd.getDate();
    const daysActive = daysInMonth - start.getDate() + 1;
    const factor = daysActive / daysInMonth;
    const prorated = recurringTotal * factor + oneTimeTotal; // one-time fees are never prorated
    return { prorated: true, days: daysActive, daysInMonth, total: Math.round(prorated * 100) / 100 };
  }
  const preview = firstInvoicePreview();
  const canProceedStep2 = depositAmount && depositDate;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">New lease</h1>
        <p className="text-sm text-ink/55 mt-1">
          Set up the agreement, rent structure, and security deposit together.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs figures font-medium shrink-0 ${
                i <= step
                  ? "bg-ledger text-paper-card"
                  : "bg-paper-card border border-border text-ink/40"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-xs ${i === step ? "text-ink font-medium" : "text-ink/45"}`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Tenant">
              <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">Select a tenant…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} — {t.cnic}
                  </option>
                ))}
              </Select>
            </Field>

            {activeLeaseForTenant && (
              <p className="text-sm text-stamp-red bg-stamp-red/5 border border-stamp-red/20 rounded-card px-3 py-2">
                This tenant already has an active lease
                {activeLeaseRoom ? ` (room ${activeLeaseRoom.room_number})` : ""}. Terminate
                that lease before creating a new one.
              </p>
            )}

            <Field label="Building">
              <Select
                value={buildingId}
                onChange={(e) => {
                  setBuildingId(e.target.value);
                  setRoomId("");
                }}
              >
                <option value="">Select a building…</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Room" hint="Only vacant rooms are shown.">
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!buildingId}>
                <option value="">Select a room…</option>
                {vacantRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_number} {r.room_type ? `(${r.room_type})` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date">
                <Input type="date" value={startDate} onChange={(e) => handleStartDateChange(e.target.value)} />
              </Field>
              <Field label="End date" hint="Auto-filled to 1 year from start — edit if the agreement is shorter or longer.">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDateTouched(true);
                    setEndDate(e.target.value);
                  }}
                />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-ink/55">
              Each fee is tracked separately so it can be changed later without
              losing the history of what was charged before.
            </p>
            {charges.map((c, i) => {
              const isKnownLabel = c.label && chargeMappings.some((m) => m.label.toLowerCase() === c.label.toLowerCase());
              return (
                <div key={i} className="border border-border rounded-card p-3 space-y-3">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Field label={i < 4 ? c.label : "Fee name"}>
                        {i < 4 ? (
                          <Input value={c.label} disabled />
                        ) : (
                          <Input
                            placeholder="e.g. Generator charges"
                            value={c.label}
                            onChange={(e) => updateCharge(i, "label", e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                    <div className="w-32">
                      <Field label="Amount">
                        <AmountInput
                          value={c.amount}
                          onChange={(e) => updateCharge(i, "amount", e.target.value)}
                        />
                      </Field>
                    </div>
                    {i >= 4 && (
                      <Button variant="ghost" onClick={() => removeCharge(i)} className="mb-0.5">
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="w-44">
                      <Field label="Charged">
                        <Select
                          value={c.recurrence}
                          onChange={(e) => updateCharge(i, "recurrence", e.target.value as "recurring" | "one_time")}
                        >
                          <option value="recurring">Every month</option>
                          <option value="one_time">Once, at signing only</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="flex-1">
                      <Field
                        label="Posts to account"
                        hint={
                          isKnownLabel
                            ? undefined
                            : c.label
                            ? `New — pick an account once, and every future "${c.label}" charge will use it automatically.`
                            : undefined
                        }
                      >
                        <Select value={c.account_id} onChange={(e) => updateCharge(i, "account_id", e.target.value)}>
                          <option value="">Select account…</option>
                          {accounts
                            .filter((a) => a.account_type === "income")
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} · {a.name}{a.transfers_to_owner ? " (owner)" : " (company)"}
                              </option>
                            ))}
                        </Select>
                      </Field>
                    </div>
                  </div>
                </div>
              );
            })}
            <Button variant="secondary" onClick={addCustomCharge}>
              + Add another fee
            </Button>

            <div className="ledger-rule pt-3 flex items-center justify-between">
              <span className="text-sm font-medium">Total monthly rent</span>
              <span className="text-lg font-display font-semibold figures">
                {formatPkr(recurringTotal)}
              </span>
            </div>
            {oneTimeTotal > 0 && (
              <p className="text-xs text-ink/50 -mt-2">
                Plus {formatPkr(oneTimeTotal)} in one-time fees on the first invoice only.
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field label="Security deposit amount">
              <AmountInput
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 40000"
              />
            </Field>
            <Field label="Date received" hint="Defaults to the lease start date.">
              <Input
                type="date"
                value={depositDate || startDate}
                onChange={(e) => setDepositDate(e.target.value)}
              />
            </Field>
            <p className="text-xs text-ink/50">
              This is held against damages or unpaid dues, and refunded (in full
              or in part) once the lease ends. It always posts to the same
              "Security Deposits Held" account — kept fixed rather than
              per-lease, so every deposit in your books stays on one
              consistent, auditable liability line.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">Tenant</p>
              <p className="text-sm">
                {tenants.find((t) => t.id === tenantId)?.full_name ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">Room</p>
              <p className="text-sm">
                {rooms.find((r) => r.id === roomId)?.room_number ?? "—"} &middot;{" "}
                {startDate} to {endDate}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">
                Monthly charges
              </p>
              <div className="space-y-1.5">
                {charges
                  .filter((c) => c.label && c.amount)
                  .map((c, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-ink/70">{c.label}</span>
                      <span className="figures">{formatPkr(parseFloat(c.amount))}</span>
                    </div>
                  ))}
                <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-border">
                  <span>Total</span>
                  <span className="figures">{formatPkr(totalRent)}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">
                Security deposit
              </p>
              <p className="text-sm figures">
                {formatPkr(parseFloat(depositAmount || "0"))}
              </p>
            </div>
            {preview && (
              <div className="bg-brass/10 border border-brass/25 rounded-card px-3 py-2">
                <p className="text-sm font-medium">
                  First invoice will be prorated: {formatPkr(preview.total)}
                </p>
                <p className="text-xs text-ink/50 mt-0.5">
                  {preview.days} of {preview.daysInMonth} days this month
                  {oneTimeTotal > 0 ? ` — recurring charges prorated, ${formatPkr(oneTimeTotal)} in one-time fees charged in full` : ""}.
                  Every month after this one is charged in full.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-stamp-red">{error}</p>}
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            onClick={() => setStep((s) => s + 1)}
            disabled={
              (step === 0 && !canProceedStep0) ||
              (step === 1 && !canProceedStep1) ||
              (step === 2 && !canProceedStep2)
            }
          >
            Continue
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating lease…" : "Create lease"}
          </Button>
        )}
      </div>
    </div>
  );
}
