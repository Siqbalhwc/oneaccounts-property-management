"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Tenant, Room, Building, Account } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, AmountInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

type Charge = { label: string; amount: string; recurrence: "recurring" | "one_time"; account_id: string; show_on_invoice: boolean };
type ChargeMapping = { label: string; account_id: string };
type LeaseSummary = { tenant_id: string; status: string; room_id: string };

const STEPS = ["Tenant & apartment", "Rent structure", "Security deposit", "Review"] as const;

// These are just a convenient starting point, not fixed/locked fields --
// every row (label, amount, recurrence, account) is editable, and any row
// (including these) can be removed. Add more via "+ Add another fee".
// Only Rent prints on the invoice PDF by default -- every other head starts
// unchecked (still counted fully in the total/ledger either way); each
// checkbox can still be toggled per-lease as needed.
const DEFAULT_CHARGES: Charge[] = [
  { label: "Rent", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: true },
  { label: "Service Charges", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Collection Deduction", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Gas", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Parking", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Cable & Net Package", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Internet", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Tv Cable", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
  { label: "Electricity", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: false },
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
  const [depositReceived, setDepositReceived] = useState(true);
  const [depositAccountId, setDepositAccountId] = useState("");

  // The deposit date field visually defaults to the lease start date, but
  // the underlying STATE stayed empty until this fired -- which is exactly
  // what made Continue stay disabled even though a date was showing.
  useEffect(() => {
    if (step === 2 && !depositDate && startDate) {
      setDepositDate(startDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, startDate]);

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

  // Only tenants without a currently-active lease are eligible for a new
  // agreement -- filters the underlying list, the field itself still works
  // exactly as before.
  const availableTenants = tenants.filter(
    (t) => !existingLeases.some((l) => l.tenant_id === t.id && l.status === "active")
  );

  // "Posts to account" options for the searchable dropdown -- label folds
  // in the account code so typing the code filters just like typing the
  // name does (same convention as the Journal Entry page).
  const postingAccounts = accounts.filter(
    (a) => a.account_type === "income" || a.account_type === "liability"
  );
  const accountOptions = useMemo(
    () =>
      postingAccounts.map((a) => ({
        value: a.id,
        label: `${a.code} · ${a.name}${a.transfers_to_owner ? " (owner)" : " (company)"}`,
      })),
    [accounts]
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

  // Selecting an account fills in the fee name to match it (e.g. picking
  // "4400 · Gas Recovery Income" sets the label to "Gas Recovery Income") so
  // the two stay in sync by default -- the label field remains a normal
  // text input, so it can still be renamed afterward if needed.
  function updateChargeAccount(index: number, accountId: string) {
    const account = accounts.find((a) => a.id === accountId);
    setCharges((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, account_id: accountId, label: account ? account.name : c.label } : c
      )
    );
  }

  function toggleChargeShowOnInvoice(index: number, value: boolean) {
    setCharges((prev) => prev.map((c, i) => (i === index ? { ...c, show_on_invoice: value } : c)));
  }

  function addCustomCharge() {
    setCharges((prev) => [...prev, { label: "", amount: "", recurrence: "recurring", account_id: "", show_on_invoice: true }]);
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
          show_on_invoice: c.show_on_invoice,
        })),
        security_deposit_amount: parseFloat(depositAmount || "0"),
        security_deposit_date_received: depositDate || startDate,
        security_deposit_is_received: depositReceived,
        security_deposit_received_account_id: depositReceived ? depositAccountId || null : null,
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
  function computeBillPreview() {
    if (!startDate) return null;
    const start = new Date(startDate + "T00:00:00");
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const daysInMonth = monthEnd.getDate();
    const daysActive = daysInMonth - start.getDate() + 1;
    const factor = daysActive / daysInMonth;
    const isProrated = start.getDate() !== 1;
    const lineItems = filledCharges.map((c) => {
      const monthlyAmount = parseFloat(c.amount) || 0;
      const currentAmount =
        c.recurrence === "one_time" ? monthlyAmount : Math.round(monthlyAmount * factor * 100) / 100;
      return { label: c.label, recurrence: c.recurrence, monthlyAmount, currentAmount };
    });
    const currentSubtotal = lineItems.reduce((s, li) => s + li.currentAmount, 0);
    return { isProrated, days: daysActive, daysInMonth, lineItems, currentSubtotal };
  }
  const billPreview = computeBillPreview();
  const canProceedStep2 =
    depositAmount &&
    depositDate &&
    (parseFloat(depositAmount) <= 0 || !depositReceived || depositAccountId);

  return (
    <div className="max-w-5xl space-y-6">
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
            <Field label="Tenant" hint="Only tenants without a currently-active lease are shown.">
              <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">Select a tenant…</option>
                {availableTenants.map((t) => (
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

            <Field label="Apartment" hint="Only vacant apartments are shown.">
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!buildingId}>
                <option value="">Select an apartment…</option>
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
                <div key={i} className="border border-border rounded-card p-3">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                    <div className="lg:col-span-3">
                      <Field label="Fee name">
                        <Input
                          placeholder="e.g. Generator charges"
                          value={c.label}
                          onChange={(e) => updateCharge(i, "label", e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="lg:col-span-2">
                      <Field label="Amount">
                        <AmountInput
                          value={c.amount}
                          onChange={(e) => updateCharge(i, "amount", e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="lg:col-span-2">
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
                    <div className="lg:col-span-4">
                      <Field
                        label="Posts to account"
                        hint={
                          isKnownLabel
                            ? undefined
                            : c.label
                            ? `New — remembered automatically from now on.`
                            : undefined
                        }
                      >
                        <SearchableSelect
                          value={c.account_id}
                          onChange={(v) => updateChargeAccount(i, v)}
                          options={accountOptions}
                          placeholder="Search by account name or code…"
                          emptyLabel="No accounts match"
                        />
                      </Field>
                    </div>
                    <div className="lg:col-span-1 flex lg:justify-end lg:pt-6">
                      <Button variant="ghost" onClick={() => removeCharge(i)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink/50 mt-2">
                    <input
                      type="checkbox"
                      checked={c.show_on_invoice}
                      onChange={(e) => toggleChargeShowOnInvoice(i, e.target.checked)}
                    />
                    Print this line on the invoice PDF (unchecking still counts it in the total)
                  </label>
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
            <Field label={depositReceived ? "Date received" : "Date agreed"} hint="Defaults to the lease start date.">
              <Input
                type="date"
                value={depositDate || startDate}
                onChange={(e) => setDepositDate(e.target.value)}
              />
            </Field>

            {parseFloat(depositAmount || "0") > 0 && (
              <Field label="Has the deposit been collected yet?">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={depositReceived ? "primary" : "secondary"}
                    onClick={() => setDepositReceived(true)}
                  >
                    Yes, collected already
                  </Button>
                  <Button
                    type="button"
                    variant={!depositReceived ? "primary" : "secondary"}
                    onClick={() => setDepositReceived(false)}
                  >
                    Not yet — pending
                  </Button>
                </div>
              </Field>
            )}

            {parseFloat(depositAmount || "0") > 0 && depositReceived && (
              <Field label="Received into which account?">
                <Select value={depositAccountId} onChange={(e) => setDepositAccountId(e.target.value)}>
                  <option value="">Select account…</option>
                  {accounts
                    .filter((a) => a.account_type === "asset")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                </Select>
              </Field>
            )}

            <p className="text-xs text-ink/50">
              This is held against damages or unpaid dues, and refunded (in full
              or in part) once the lease ends. It always posts to the same
              "Security Deposits Held" account — kept fixed rather than
              per-lease, so every deposit in your books stays on one
              consistent, auditable liability line.
              {parseFloat(depositAmount || "0") > 0 &&
                (depositReceived
                  ? " The journal entry for this deposit posts immediately, once the lease is created."
                  : " Since it isn't collected yet, nothing posts to your books until you record the receipt later from the Leases list.")}
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
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">Apartment</p>
              <p className="text-sm">
                {rooms.find((r) => r.id === roomId)?.room_number ?? "—"} &middot;{" "}
                {startDate} to {endDate}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">
                  Monthly agreement (from next month)
                </p>
                <div className="space-y-1.5">
                  {billPreview?.lineItems
                    .filter((li) => li.recurrence === "recurring")
                    .map((li, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-ink/70">{li.label}</span>
                        <span className="figures">{formatPkr(li.monthlyAmount)}</span>
                      </div>
                    ))}
                  <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-border">
                    <span>Total agreement</span>
                    <span className="figures">{formatPkr(recurringTotal)}</span>
                  </div>
                  {oneTimeTotal > 0 && (
                    <p className="text-xs text-ink/45 pt-1">
                      Plus {formatPkr(oneTimeTotal)} one-time, at signing only — not repeated.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">
                  {billPreview?.isProrated ? `Current bill (${billPreview.days} of ${billPreview.daysInMonth} days)` : "Current bill (full month)"}
                </p>
                <div className="space-y-1.5">
                  {billPreview?.lineItems.map((li, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-ink/70">
                        {li.label}
                        {li.recurrence === "one_time" && <span className="text-ink/35 text-xs"> (one-time)</span>}
                      </span>
                      <span className="figures">{formatPkr(li.currentAmount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-border">
                    <span>Current bill subtotal</span>
                    <span className="figures">{formatPkr(billPreview?.currentSubtotal ?? 0)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-1">
                Security deposit
              </p>
              <div className="flex items-center gap-2">
                <p className="text-sm figures">
                  {formatPkr(parseFloat(depositAmount || "0"))}
                </p>
                {parseFloat(depositAmount || "0") > 0 && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      depositReceived
                        ? "bg-ledger/10 text-ledger"
                        : "bg-brass/15 text-brass"
                    }`}
                  >
                    {depositReceived ? "Received" : "Pending"}
                  </span>
                )}
              </div>
              {parseFloat(depositAmount || "0") > 0 && depositReceived && depositAccountId && (
                <p className="text-xs text-ink/45 mt-1">
                  Into: {accounts.find((a) => a.id === depositAccountId)?.name ?? ""}
                </p>
              )}
            </div>

            <div className="bg-brass/10 border border-brass/25 rounded-card px-3 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Total due now</p>
                <p className="text-xs text-ink/50 mt-0.5">
                  Current bill + security deposit. Every month after this one is billed in full ({formatPkr(recurringTotal)}).
                </p>
              </div>
              <span className="text-lg font-display font-semibold figures">
                {formatPkr((billPreview?.currentSubtotal ?? 0) + parseFloat(depositAmount || "0"))}
              </span>
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
