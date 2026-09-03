"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, Account, Invoice, Tenant, Room, Building } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { SearchableSelect, ComboOption } from "@/components/ui/SearchableSelect";

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

type OutstandingInvoice = Invoice & { balance: number };

type Summary = {
  lease_id: string;
  tenant_id: string;
  room_id: string;
  outstanding_invoices: OutstandingInvoice[];
  running_balance: number;
};

export default function ReceivePaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leaseId = searchParams.get("lease_id") || "";

  const [role, setRole] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountReceived, setAmountReceived] = useState("");
  const [offerDiscount, setOfferDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountAccountId, setDiscountAccountId] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isOwnerOrAdmin = role === "owner" || role === "admin";

  useEffect(() => {
    if (!leaseId) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (userId) {
        const { data: profileRow } = await supabase.from("profiles").select("role").eq("id", userId).single();
        setRole(profileRow?.role ?? null);
      }

      const [s, accts] = await Promise.all([
        api.get<Summary>(`/leases/${leaseId}/receivable-summary`),
        api.get<Account[]>("/chart-of-accounts"),
      ]);
      setSummary(s);
      setAccounts(accts);

      const initialTicked: Record<string, boolean> = {};
      s.outstanding_invoices.forEach((i) => (initialTicked[i.id] = true));
      setTicked(initialTicked);

      const ticketTotal = s.outstanding_invoices.reduce((sum, i) => sum + i.balance, 0);
      setAmountReceived(ticketTotal ? String(ticketTotal) : "");

      const [t, r] = await Promise.all([
        api.get<Tenant>(`/tenants/${s.tenant_id}`),
        api.get<Room>(`/rooms/${s.room_id}`),
      ]);
      setTenant(t);
      setRoom(r);
      if (r) setBuilding(await api.get<Building>(`/buildings/${r.building_id}`));

      const discountDefault = accts.find((a) => a.name.toLowerCase().includes("discount"));
      if (discountDefault) setDiscountAccountId(discountDefault.id);

      setLoading(false);
    })();
  }, [leaseId]);

  const tickedInvoices = useMemo(
    () => (summary?.outstanding_invoices ?? []).filter((i) => ticked[i.id]),
    [summary, ticked]
  );
  const totalReceivable = useMemo(
    () => tickedInvoices.reduce((sum, i) => sum + i.balance, 0),
    [tickedInvoices]
  );

  const receivedNum = parseFloat(amountReceived) || 0;
  const discountNum = offerDiscount ? parseFloat(discountAmount) || 0 : 0;
  const advanceAmount = Math.max(0, round2(receivedNum - totalReceivable));
  const remaining = round2(totalReceivable - receivedNum - discountNum);

  function round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  const accountOptions: ComboOption[] = accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!accountId) {
      setError("Select which account this payment was received into.");
      return;
    }
    if (receivedNum <= 0 && tickedInvoices.length === 0) {
      setError("Enter an amount received, or tick at least one invoice.");
      return;
    }
    if (offerDiscount && discountNum > 0 && !discountAccountId) {
      setError("Select which account the discount should be charged to.");
      return;
    }
    if (offerDiscount && discountNum > 0 && receivedNum + discountNum > totalReceivable + 0.01) {
      setError("Amount received plus discount can't exceed the ticked invoices' total balance.");
      return;
    }

    setSaving(true);
    try {
      await api.post<{ advance_amount: number }>("/payments/receipt", {
        lease_id: leaseId,
        account_id: accountId,
        payment_method: paymentMethod,
        receipt_date: receiptDate,
        amount_received: receivedNum,
        invoice_ids: tickedInvoices.map((i) => i.id),
        discount_amount: discountNum,
        discount_account_id: discountNum > 0 ? discountAccountId : undefined,
        notes: notes || undefined,
      });
      router.push("/invoices");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!leaseId) {
    return <Card>No lease specified. Open this page from an invoice's payment icon.</Card>;
  }
  if (loading || !summary) {
    return <Card>Loading…</Card>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Receive payment</h1>
        <p className="text-sm text-ink/55 mt-1">
          {tenant?.full_name ?? "—"} — {building?.name ?? "—"}
          {room ? `, Room ${room.room_number}` : ""}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div>
                <span className="block text-sm font-medium text-ink mb-1.5">Apply to invoices (oldest first)</span>
                <div className="border border-border rounded-card divide-y divide-border">
                  {summary.outstanding_invoices.length === 0 && (
                    <p className="text-sm text-ink/50 p-3">No outstanding invoices for this lease.</p>
                  )}
                  {summary.outstanding_invoices.map((inv) => (
                    <label key={inv.id} className="flex items-center justify-between px-3 py-2.5 text-sm cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!ticked[inv.id]}
                          onChange={(e) => setTicked({ ...ticked, [inv.id]: e.target.checked })}
                        />
                        {inv.invoice_month}
                      </span>
                      <span className="figures">{formatPkr(inv.balance)}</span>
                    </label>
                  ))}
                </div>
                <div className="flex justify-between text-sm font-medium px-1 py-3">
                  <span>Total receivable</span>
                  <span className="figures">{formatPkr(totalReceivable)}</span>
                </div>
              </div>

              <Field label="Notes">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional note for this receipt"
                  className="w-full px-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors resize-y"
                />
              </Field>

              {summary.running_balance < 0 && (
                <p className="text-xs text-stamp-green">
                  This lease currently has an advance/credit of {formatPkr(Math.abs(summary.running_balance))} on file.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <Field label="Received into">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Payment method">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </Select>
              </Field>

              <Field label="Receipt date">
                <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </Field>

              <Field label="Amount received">
                <AmountInput
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(e.target.value)}
                  step="0.01"
                />
              </Field>

              {advanceAmount > 0.01 && (
                <p className="text-xs text-ink/55">
                  {formatPkr(advanceAmount)} more than the ticked invoices need — this will be recorded as an
                  advance on the lease.
                </p>
              )}

              {isOwnerOrAdmin && (
                <div className="bg-brass-dark/5 rounded-card p-3 space-y-2">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-medium text-ink">Offer a discount</span>
                    <input
                      type="checkbox"
                      checked={offerDiscount}
                      onChange={(e) => setOfferDiscount(e.target.checked)}
                    />
                  </label>
                  {offerDiscount && (
                    <>
                      <AmountInput
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(e.target.value)}
                        step="0.01"
                        placeholder="0"
                      />
                      <SearchableSelect
                        value={discountAccountId}
                        onChange={setDiscountAccountId}
                        options={accountOptions}
                        placeholder="Search accounts…"
                      />
                    </>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center border-t border-border pt-3">
                <span className="text-sm font-medium">Remaining balance</span>
                <span className={`text-lg font-medium figures ${remaining > 0.01 ? "text-stamp-amber" : "text-stamp-green"}`}>
                  {formatPkr(remaining)}
                </span>
              </div>

              {error && <p className="text-sm text-stamp-red">{error}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? "Saving…" : "Record receipt"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}
