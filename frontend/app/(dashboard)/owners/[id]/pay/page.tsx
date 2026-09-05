"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, Account } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { SearchableSelect, ComboOption } from "@/components/ui/SearchableSelect";

type Owner = { id: string; name: string; phone?: string };

type BreakdownLine = {
  entry_date: string;
  description?: string;
  source_type?: string;
  account_name?: string;
  direction: "debit" | "credit";
  amount: number;
  building_name?: string;
  room_number?: string;
  running_balance: number;
};

type Breakdown = { lines: BreakdownLine[]; balance: number };

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function PayOwnerPage() {
  const router = useRouter();
  const params = useParams();
  const ownerId = String(params.id);

  const [owner, setOwner] = useState<Owner | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountPaid, setAmountPaid] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [owners, bd, accts] = await Promise.all([
        api.get<Owner[]>("/owners?include_archived=true"),
        api.get<Breakdown>(`/owner-ledger/breakdown/${ownerId}`),
        api.get<Account[]>("/chart-of-accounts"),
      ]);
      setOwner(owners.find((o) => o.id === ownerId) ?? null);
      setBreakdown(bd);
      setAccounts(accts);
      setAmountPaid(bd.balance > 0 ? String(bd.balance) : "");
      setLoading(false);
    })();
  }, [ownerId]);

  const accountOptions: ComboOption[] = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts]
  );

  const balance = breakdown?.balance ?? 0;
  const remaining = Math.round((balance - (parseFloat(amountPaid) || 0)) * 100) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!accountId) {
      setError("Select which account this payout is coming out of.");
      return;
    }
    const amount = parseFloat(amountPaid) || 0;
    if (amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setSaving(true);
    try {
      await api.post("/owner-ledger/pay-owner", {
        owner_id: ownerId,
        amount_paid: amount,
        paid_date: paidDate,
        account_id: accountId,
        payment_method: paymentMethod,
        notes: notes || undefined,
      });
      router.push("/owners");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !breakdown) {
    return <Card>Loading…</Card>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Pay owner</h1>
        <p className="text-sm text-ink/55 mt-1">{owner?.name ?? "—"}</p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div>
                <span className="block text-sm font-medium text-ink mb-1.5">
                  What makes up this balance
                </span>
                <p className="text-xs text-ink/50 mb-2">
                  Every rent credit and any expense charged to this owner, oldest first.
                </p>
                <div className="border border-border rounded-card divide-y divide-border max-h-80 overflow-y-auto">
                  {breakdown.lines.length === 0 && (
                    <p className="text-sm text-ink/50 p-3">No activity on file for this owner yet.</p>
                  )}
                  {breakdown.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 text-sm">
                      <div>
                        <p className="text-ink/80">{l.description || l.account_name || "—"}</p>
                        <p className="text-xs text-ink/45">
                          {l.entry_date}
                          {l.building_name ? ` · ${l.building_name}` : ""}
                          {l.room_number ? ` — Apartment ${l.room_number}` : ""}
                        </p>
                      </div>
                      <span
                        className={`figures ${l.direction === "credit" ? "text-ink" : "text-stamp-red"}`}
                      >
                        {l.direction === "credit" ? "+" : "-"}
                        {formatPkr(l.amount)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-sm font-medium px-1 py-3">
                  <span>Current balance owed</span>
                  <span className="figures">{formatPkr(balance)}</span>
                </div>
              </div>

              <Field label="Notes">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional note for this payout"
                  className="w-full px-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors resize-y"
                />
              </Field>
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

              <Field label="Amount to pay now">
                <AmountInput value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} step="0.01" />
              </Field>

              <div className="flex justify-between items-center border-t border-border pt-3">
                <span className="text-sm font-medium">Remaining after this payout</span>
                <span
                  className={`text-lg font-medium figures ${remaining > 0.01 ? "text-stamp-amber" : "text-stamp-green"}`}
                >
                  {formatPkr(remaining)}
                </span>
              </div>

              {error && <p className="text-sm text-stamp-red">{error}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? "Saving…" : "Record payout"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}
