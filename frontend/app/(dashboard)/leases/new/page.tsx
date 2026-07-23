"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Tenant, Room, Building } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, AmountInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

type Charge = { label: string; amount: string };

const STEPS = ["Tenant & room", "Rent structure", "Security deposit", "Review"] as const;

const DEFAULT_CHARGES: Charge[] = [
  { label: "Rent", amount: "" },
  { label: "Internet fee", amount: "" },
  { label: "Parking fee", amount: "" },
  { label: "Water bill", amount: "" },
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

  // Step 1
  const [tenantId, setTenantId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Step 2
  const [charges, setCharges] = useState<Charge[]>(DEFAULT_CHARGES);

  // Step 3
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDate, setDepositDate] = useState("");

  useEffect(() => {
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Room[]>("/rooms").then(setRooms);
  }, []);

  const vacantRooms = rooms.filter(
    (r) => r.building_id === buildingId && r.status === "vacant"
  );

  const totalRent = charges.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

  function updateCharge(index: number, field: keyof Charge, value: string) {
    setCharges((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }

  function addCustomCharge() {
    setCharges((prev) => [...prev, { label: "", amount: "" }]);
  }

  function removeCharge(index: number) {
    setCharges((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/leases", {
        tenant_id: tenantId,
        room_id: roomId,
        start_date: startDate,
        end_date: endDate,
        charges: charges
          .filter((c) => c.label && c.amount)
          .map((c) => ({ label: c.label, amount: parseFloat(c.amount) })),
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

  const canProceedStep0 = tenantId && roomId && startDate && endDate;
  const canProceedStep1 = charges.some((c) => c.label && c.amount);
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
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="End date" hint="Usually 1 year from start.">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
            {charges.map((c, i) => (
              <div key={i} className="flex items-end gap-3">
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
                <div className="w-40">
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
            ))}
            <Button variant="secondary" onClick={addCustomCharge}>
              + Add another fee
            </Button>

            <div className="ledger-rule pt-3 flex items-center justify-between">
              <span className="text-sm font-medium">Total monthly rent</span>
              <span className="text-lg font-display font-semibold figures">
                {formatPkr(totalRent)}
              </span>
            </div>
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
            <Field label="Date received">
              <Input
                type="date"
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
              />
            </Field>
            <p className="text-xs text-ink/50">
              This is held against damages or unpaid dues, and refunded (in full
              or in part) once the lease ends.
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
