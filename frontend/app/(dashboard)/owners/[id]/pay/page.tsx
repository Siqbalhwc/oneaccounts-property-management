"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, Account } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { SearchableSelect, ComboOption } from "@/components/ui/SearchableSelect";
import { StampBadge } from "@/components/ui/StampBadge";

type Owner = { id: string; name: string; phone?: string };

type Unit = {
  line_id: string;
  kind: "rent" | "other_credit" | "expense";
  entry_date: string;
  description?: string;
  invoice_id?: string | null;
  invoice_month?: string | null;
  invoice_status?: string | null;
  invoice_total?: number | null;
  building_name?: string | null;
  room_number?: string | null;
  tenant_name?: string | null;
  amount: number;
  settled: number;
  remaining: number;
  status: "pending" | "partial" | "settled";
};

type RoomRow = {
  room_id: string | null;
  building_name?: string | null;
  room_number: string;
  rent_billed: number;
  rent_paid: number;
  rent_open: number;
  expenses_open: number;
  balance: number;
  status: "payable" | "expenses_due" | "settled";
};

type Settlement = {
  units: Unit[];
  rooms: RoomRow[];
  unapplied_payments: number;
  ledger_balance: number;
  totals: {
    rent_payable: number;
    rent_settled: number;
    expenses_open: number;
    net_payable: number;
    rooms_payable: number;
    rooms_settled: number;
  };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function monthLabel(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function RoomStatus({ status }: { status: RoomRow["status"] }) {
  const map = {
    payable: { label: "Payable to owner", cls: "bg-stamp-red/10 text-stamp-red border-stamp-red/30" },
    expenses_due: { label: "Expenses to net", cls: "bg-stamp-amber/10 text-stamp-amber border-stamp-amber/30" },
    settled: { label: "Settled", cls: "bg-stamp-green/10 text-stamp-green border-stamp-green/30" },
  }[status];
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${map.cls}`}>
      {map.label}
    </span>
  );
}

function UnitStatus({ status }: { status: Unit["status"] }) {
  const map = {
    pending: { label: "Pending", cls: "bg-stamp-red/10 text-stamp-red border-stamp-red/30" },
    partial: { label: "Part paid", cls: "bg-stamp-amber/10 text-stamp-amber border-stamp-amber/30" },
    settled: { label: "Paid to owner", cls: "bg-stamp-green/10 text-stamp-green border-stamp-green/30" },
  }[status];
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${map.cls}`}>
      {map.label}
    </span>
  );
}

export default function PayOwnerPage() {
  const router = useRouter();
  const params = useParams();
  const ownerId = String(params.id);

  const [owner, setOwner] = useState<Owner | null>(null);
  const [data, setData] = useState<Settlement | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // line_id -> amount string (present = ticked)
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [showSettled, setShowSettled] = useState(false);
  const [collectedOnly, setCollectedOnly] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    const d = await api.get<Settlement>(`/owner-ledger/settlement/${ownerId}`);
    setData(d);
    setSelected({});
  }

  useEffect(() => {
    (async () => {
      try {
        const [owners, accts] = await Promise.all([
          api.get<Owner[]>("/owners?include_archived=true"),
          api.get<Account[]>("/chart-of-accounts"),
        ]);
        setOwner(owners.find((o) => o.id === ownerId) ?? null);
        setAccounts(accts);
        await load();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const accountOptions: ComboOption[] = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts]
  );

  const rentUnits = useMemo(() => (data?.units ?? []).filter((u) => u.kind !== "expense"), [data]);
  const expenseUnits = useMemo(() => (data?.units ?? []).filter((u) => u.kind === "expense"), [data]);

  const visibleRent = rentUnits.filter((u) => {
    if (!showSettled && u.status === "settled") return false;
    if (collectedOnly && u.invoice_status && u.invoice_status !== "paid") return false;
    return true;
  });
  const visibleExpenses = expenseUnits.filter((u) => showSettled || u.status !== "settled");

  const unitById = useMemo(() => Object.fromEntries((data?.units ?? []).map((u) => [u.line_id, u])), [data]);

  function amountFor(id: string) {
    const u = unitById[id];
    if (!u) return 0;
    return Math.min(u.remaining, Math.max(0, parseFloat(selected[id] ?? "0") || 0));
  }

  const rentSelected = r2(rentUnits.reduce((s, u) => (u.line_id in selected ? s + amountFor(u.line_id) : s), 0));
  const expSelected = r2(expenseUnits.reduce((s, u) => (u.line_id in selected ? s + amountFor(u.line_id) : s), 0));
  const netPayout = r2(rentSelected - expSelected);
  const balanceAfter = r2((data?.ledger_balance ?? 0) - netPayout);
  const selectedCount = Object.keys(selected).length;

  function toggle(u: Unit, on: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      if (on) next[u.line_id] = String(u.remaining);
      else delete next[u.line_id];
      return next;
    });
  }

  function selectAllRent() {
    setSelected((prev) => {
      const next = { ...prev };
      visibleRent.filter((u) => u.remaining > 0).forEach((u) => (next[u.line_id] = String(u.remaining)));
      return next;
    });
  }

  function netAllExpenses() {
    setSelected((prev) => {
      const next = { ...prev };
      visibleExpenses.filter((u) => u.remaining > 0).forEach((u) => (next[u.line_id] = String(u.remaining)));
      return next;
    });
  }

  function clearAll() {
    setSelected({});
  }

  async function applyEarlier() {
    setApplying(true);
    setError(null);
    try {
      await api.post(`/owner-ledger/apply-earlier-payouts/${ownerId}`, {});
      await load();
      setSuccess("Earlier payouts were matched to the oldest open rent.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (selectedCount === 0) {
      setError("Tick at least one invoice to pay.");
      return;
    }
    if (netPayout < 0) {
      setError("Netted expenses are more than the rent selected — tick more rent or fewer expenses.");
      return;
    }
    if (netPayout > 0 && !accountId) {
      setError("Select which account this payout is coming out of.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/owner-ledger/pay-owner-allocated", {
        owner_id: ownerId,
        selections: Object.keys(selected).map((id) => ({ line_id: id, amount: amountFor(id) })),
        paid_date: paidDate,
        account_id: accountId || undefined,
        payment_method: paymentMethod,
        notes: notes || undefined,
      });
      setSuccess(`Payout of ${formatPkr(netPayout)} recorded.`);
      setNotes("");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Card>Loading…</Card>;
  if (!data) return <Card>{error ?? "Could not load this owner."}</Card>;

  const t = data.totals;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={() => router.push("/owners")} className="text-sm text-ledger hover:underline mb-2">
            ← Owners
          </button>
          <h1 className="text-2xl font-display font-semibold">Pay owner</h1>
          <p className="text-sm text-ink/55 mt-1">{owner?.name ?? "—"}</p>
        </div>
      </div>

      {/* ---------- Summary ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <p className="text-xs uppercase tracking-wider text-ink/45">Rent payable to owner</p>
          <p className="text-xl font-display font-semibold figures text-stamp-red mt-1">{formatPkr(t.rent_payable)}</p>
          <p className="text-xs text-ink/50 mt-1">{t.rooms_payable} room(s) pending</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wider text-ink/45">Already paid to owner</p>
          <p className="text-xl font-display font-semibold figures text-stamp-green mt-1">{formatPkr(t.rent_settled)}</p>
          <p className="text-xs text-ink/50 mt-1">{t.rooms_settled} room(s) fully settled</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wider text-ink/45">Expenses to net off</p>
          <p className="text-xl font-display font-semibold figures mt-1">{formatPkr(t.expenses_open)}</p>
          <p className="text-xs text-ink/50 mt-1">Charged to this owner</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wider text-ink/45">Net balance (= owner ledger)</p>
          <p className="text-xl font-display font-semibold figures mt-1">{formatPkr(data.ledger_balance)}</p>
          <p className="text-xs text-ink/50 mt-1">Rent − expenses − earlier payouts</p>
        </Card>
      </div>

      {data.unapplied_payments > 0.005 && (
        <Card className="border-stamp-amber/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-medium">{formatPkr(data.unapplied_payments)}</span> was paid to this owner before
              room-level tracking existed, so it isn&apos;t matched to any room yet. Match it to the oldest open rent to
              get correct room statuses (no accounting entry is posted; the ledger balance doesn&apos;t change).
            </p>
            <Button variant="secondary" onClick={applyEarlier} disabled={applying}>
              {applying ? "Applying…" : "Apply earlier payouts"}
            </Button>
          </div>
        </Card>
      )}

      {/* ---------- Room overview ---------- */}
      <Card>
        <h2 className="font-display text-lg font-semibold mb-1">Room-wise status</h2>
        <p className="text-xs text-ink/50 mb-3">Every room this owner receives rent for, and what is still payable.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink/45 border-b border-border">
                <th className="py-2 pr-3">Building / Room</th>
                <th className="py-2 pr-3 text-right">Rent billed</th>
                <th className="py-2 pr-3 text-right">Paid to owner</th>
                <th className="py-2 pr-3 text-right">Expenses open</th>
                <th className="py-2 pr-3 text-right">Balance payable</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rooms.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink/45">
                    No rent has been posted for this owner yet.
                  </td>
                </tr>
              )}
              {data.rooms.map((r, i) => (
                <tr key={r.room_id ?? i} className={r.status === "settled" ? "text-ink/55" : ""}>
                  <td className="py-2.5 pr-3">
                    <span className="font-medium">{r.room_number}</span>
                    <span className="text-ink/50"> · {r.building_name ?? "—"}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right figures">{formatPkr(r.rent_billed)}</td>
                  <td className="py-2.5 pr-3 text-right figures">{formatPkr(r.rent_paid)}</td>
                  <td className="py-2.5 pr-3 text-right figures">{formatPkr(r.expenses_open)}</td>
                  <td className={`py-2.5 pr-3 text-right figures font-semibold ${r.balance > 0.005 ? "text-stamp-red" : ""}`}>
                    {formatPkr(r.balance)}
                  </td>
                  <td className="py-2.5">
                    <RoomStatus status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 space-y-6">
          {/* ---------- Invoices ---------- */}
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Select invoices to pay</h2>
                <p className="text-xs text-ink/50">Tick an invoice, and change the amount to pay part of it.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={selectAllRent}>
                  Select all shown
                </Button>
                <Button type="button" variant="ghost" onClick={clearAll}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-sm text-ink/60">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
                Show already-settled
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={collectedOnly} onChange={(e) => setCollectedOnly(e.target.checked)} />
                Only invoices the tenant has paid
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-ink/45 border-b border-border">
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-3">Room</th>
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3">Tenant</th>
                    <th className="py-2 pr-3">Tenant invoice</th>
                    <th className="py-2 pr-3 text-right">Owner share</th>
                    <th className="py-2 pr-3 text-right">Paid</th>
                    <th className="py-2 pr-3 text-right">Remaining</th>
                    <th className="py-2 pr-3 w-36">Pay now</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleRent.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-ink/45">
                        Nothing to pay — every rent line shown here is settled.
                      </td>
                    </tr>
                  )}
                  {visibleRent.map((u) => {
                    const on = u.line_id in selected;
                    const disabled = u.remaining <= 0.005;
                    const uncollected = u.invoice_status && u.invoice_status !== "paid";
                    return (
                      <tr key={u.line_id} className={disabled ? "text-ink/45" : on ? "bg-brass/5" : ""}>
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={disabled}
                            onChange={(e) => toggle(u, e.target.checked)}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <span className="font-medium">{u.room_number ?? "—"}</span>
                          <span className="text-ink/50"> · {u.building_name ?? "—"}</span>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{monthLabel(u.invoice_month ?? u.entry_date)}</td>
                        <td className="py-2 pr-3">{u.tenant_name ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {u.invoice_status ? <StampBadge status={u.invoice_status} /> : <span className="text-ink/40">—</span>}
                          {on && uncollected && (
                            <p className="text-[10px] text-stamp-amber mt-0.5">Tenant hasn&apos;t fully paid</p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right figures">{formatPkr(u.amount)}</td>
                        <td className="py-2 pr-3 text-right figures">{formatPkr(u.settled)}</td>
                        <td className={`py-2 pr-3 text-right figures font-medium ${u.remaining > 0.005 ? "text-stamp-red" : ""}`}>
                          {formatPkr(u.remaining)}
                        </td>
                        <td className="py-2 pr-3">
                          {on ? (
                            <AmountInput
                              value={selected[u.line_id]}
                              max={u.remaining}
                              step="0.01"
                              onChange={(e) => setSelected({ ...selected, [u.line_id]: e.target.value })}
                            />
                          ) : (
                            <span className="text-ink/30">—</span>
                          )}
                        </td>
                        <td className="py-2">
                          <UnitStatus status={u.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ---------- Expenses ---------- */}
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Net off expenses</h2>
                <p className="text-xs text-ink/50">
                  Expenses already charged to this owner in the ledger. Tick to deduct them from this payout.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={netAllExpenses}>
                Net all expenses
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-ink/45 border-b border-border">
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3">Room</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleExpenses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-ink/45">
                        No expenses waiting to be netted for this owner.
                      </td>
                    </tr>
                  )}
                  {visibleExpenses.map((u) => {
                    const on = u.line_id in selected;
                    const disabled = u.remaining <= 0.005;
                    return (
                      <tr key={u.line_id} className={disabled ? "text-ink/45" : on ? "bg-brass/5" : ""}>
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={disabled}
                            onChange={(e) => toggle(u, e.target.checked)}
                          />
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{u.entry_date}</td>
                        <td className="py-2 pr-3">{u.description ?? "Expense"}</td>
                        <td className="py-2 pr-3">
                          {u.room_number ? `${u.room_number} · ` : ""}
                          {u.building_name ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-right figures text-stamp-red">−{formatPkr(u.remaining)}</td>
                        <td className="py-2">
                          <UnitStatus status={u.status === "settled" ? "settled" : "pending"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ---------- Payment panel ---------- */}
        <div className="xl:sticky xl:top-4">
          <Card>
            <h2 className="font-display text-lg font-semibold mb-3">Payout</h2>
            <div className="space-y-2 text-sm border border-border rounded-card px-3 py-3 mb-4">
              <div className="flex justify-between">
                <span className="text-ink/60">Rent selected</span>
                <span className="figures">{formatPkr(rentSelected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Expenses netted</span>
                <span className="figures text-stamp-red">−{formatPkr(expSelected)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>Pay owner now</span>
                <span className={`figures ${netPayout < 0 ? "text-stamp-red" : ""}`}>{formatPkr(netPayout)}</span>
              </div>
              <div className="flex justify-between text-xs text-ink/55">
                <span>Owner balance after this payout</span>
                <span className="figures">{formatPkr(balanceAfter)}</span>
              </div>
            </div>

            <div className="space-y-4">
              <Field label="Paid from" hint="Which account this payout is actually leaving from.">
                <SearchableSelect
                  value={accountId}
                  onChange={setAccountId}
                  options={accountOptions}
                  placeholder="Search accounts…"
                />
              </Field>
              <Field label="Payment method">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Date paid">
                <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </Field>
              <Field label="Notes">
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional note for this payout"
                  className="w-full px-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors resize-y"
                />
              </Field>

              {error && <p className="text-sm text-stamp-red">{error}</p>}
              {success && <p className="text-sm text-stamp-green">{success}</p>}

              <Button type="submit" className="w-full" disabled={saving || selectedCount === 0}>
                {saving ? "Saving…" : netPayout > 0 ? `Record payout of ${formatPkr(netPayout)}` : "Record settlement"}
              </Button>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
