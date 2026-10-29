"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalAuthError, PortalClaim, PortalInvoice, PortalMe, downloadPortalPdf, formatDate, formatMoney, formatMonth, portalRequest } from "@/lib/portalApi";

const STATUS: Record<PortalClaim["status"], { text: string; cls: string }> = {
  pending: { text: "Waiting for the office", cls: "bg-amber-100 text-amber-800" },
  approved: { text: "Approved", cls: "bg-green-100 text-green-800" },
  rejected: { text: "Not accepted", cls: "bg-red-100 text-red-800" },
  cancelled: { text: "Cancelled", cls: "bg-slate-100 text-slate-600" },
};
const todayStr = () => new Date().toISOString().slice(0, 10);

function Pay({ code, me }: { code: string; me: PortalMe }) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<PortalInvoice[] | null>(null);
  const [claims, setClaims] = useState<PortalClaim[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer">("bank_transfer");
  const [paidTo, setPaidTo] = useState("");
  const [date, setDate] = useState(todayStr());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const guard = useCallback((e: any) => (e instanceof PortalAuthError ? router.replace(`/portal/${code}/login`) : setError(e.message)), [code, router]);

  const load = useCallback(async () => {
    try {
      const [inv, cl] = await Promise.all([
        me.permissions.view_invoices ? portalRequest<{ invoices: PortalInvoice[] }>(code, "/portal/invoices?limit=60") : Promise.resolve({ invoices: [] as PortalInvoice[] }),
        portalRequest<{ claims: PortalClaim[] }>(code, "/portal/payment-claims"),
      ]);
      setInvoices(inv.invoices.filter((i) => i.status !== "paid"));
      setClaims(cl.claims);
    } catch (e) { guard(e); }
  }, [code, guard, me.permissions.view_invoices]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("invoice");
    if (id) setPicked([id]);
  }, []);

  const lease = invoices?.find((i) => picked.includes(i.id))?.lease_id;
  const owed = (invoices ?? []).filter((i) => picked.includes(i.id)).reduce((s, i) => s + i.balance, 0);
  useEffect(() => { setAmount(owed > 0 ? String(Math.round(owed * 100) / 100) : ""); }, [owed]);

  function toggle(id: string) { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    try {
      await portalRequest(code, "/portal/payment-claims", { method: "POST", body: JSON.stringify({
        invoice_ids: picked, amount: Number(amount), payment_method: method, paid_to: paidTo || null, payment_date: date, reference: reference || null, note: note || null,
      }) });
      setDone("Sent to your property office. Your balance changes after they confirm the payment.");
      setPicked([]); setPaidTo(""); setReference(""); setNote("");
      await load();
    } catch (err) { guard(err); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    setError(null);
    try { await portalRequest(code, `/portal/payment-claims/${id}/cancel`, { method: "POST" }); await load(); } catch (e) { guard(e); }
  }
  async function receipt(c: PortalClaim) {
    if (!c.receipt_group_id) return;
    try { await downloadPortalPdf(code, `/portal/receipts/${c.receipt_group_id}/pdf`, `receipt_${c.payment_date}.pdf`); } catch (e) { guard(e); }
  }

  const input = "w-full px-3 py-2 text-base bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark";
  if (!invoices) return <p className="text-sm text-ink/50">Loading…</p>;
  return (
    <>
      <div>
        <h1 className="font-display text-2xl font-semibold">I have paid</h1>
        <p className="text-sm text-ink/55 mt-1">Tell your property office about a payment you made. They will check it and confirm; only then does your balance change.</p>
      </div>
      {error && <p className="text-sm text-stamp-red">{error}</p>}
      {done && <p className="text-sm text-accent">{done}</p>}

      <form onSubmit={submit} className="card p-4 sm:p-5 space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Which invoice(s) did you pay?</p>
          {invoices.length === 0 ? <p className="text-sm text-ink/55">You have no unpaid invoices.</p> : (
            <div className="space-y-2">
              {invoices.map((i) => {
                const other = !!lease && lease !== i.lease_id;
                return (
                  <label key={i.id} className={`flex items-center gap-3 border border-border rounded-card px-3 py-2 text-sm ${other ? "opacity-40" : ""}`}>
                    <input type="checkbox" disabled={other} checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                    <span className="flex-1">{formatMonth(i.invoice_month)}{i.room ? ` · ${me.unit} ${i.room.number}` : ""}</span>
                    <span className="figures">{formatMoney(i.balance)}</span>
                  </label>
                );
              })}
              {!!lease && <p className="text-xs text-ink/45">Invoices from different agreements need separate payments.</p>}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="text-sm font-medium block mb-1">Amount you paid (Rs)</label><input className={input} type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div><label className="text-sm font-medium block mb-1">Date you paid</label><input className={input} type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        </div>
        <div>
          <p className="text-sm font-medium mb-1">How did you pay?</p>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={method === "bank_transfer"} onChange={() => setMethod("bank_transfer")} /> Bank transfer</label>
            <label className="flex items-center gap-2"><input type="radio" checked={method === "cash"} onChange={() => setMethod("cash")} /> Cash</label>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="text-sm font-medium block mb-1">{method === "bank_transfer" ? "Bank account number you paid into" : "Who did you hand the cash to? (optional)"}</label><input className={input} value={paidTo} onChange={(e) => setPaidTo(e.target.value)} required={method === "bank_transfer"} maxLength={80} /></div>
          <div><label className="text-sm font-medium block mb-1">Reference / transaction no. (optional)</label><input className={input} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} /></div>
        </div>
        <div><label className="text-sm font-medium block mb-1">Note (optional)</label><input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
        <button type="submit" disabled={busy || picked.length === 0} className="px-5 py-2.5 rounded-card bg-ink text-paper disabled:opacity-50">{busy ? "Sending…" : "Send to office for approval"}</button>
      </form>

      <h2 className="font-display text-xl font-semibold pt-2">My payments</h2>
      {claims.length === 0 ? <p className="text-sm text-ink/55">You haven't sent any payments yet.</p> : (
        <div className="space-y-3">
          {claims.map((c) => (
            <div key={c.id} className="card p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium figures">{formatMoney(c.status === "approved" && c.approved_amount != null ? c.approved_amount : c.amount)}</p>
                <p className="text-xs text-ink/55">{formatDate(c.payment_date)} · {c.payment_method === "cash" ? "Cash" : "Bank transfer"}{c.invoice_months.length ? ` · ${c.invoice_months.map(formatMonth).join(", ")}` : ""}</p>
                {c.status === "rejected" && c.reject_reason && <p className="text-sm mt-1"><span className="text-ink/50">Reason:</span> {c.reject_reason}</p>}
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS[c.status].cls}`}>{STATUS[c.status].text}</span>
              {c.status === "pending" && <button onClick={() => cancel(c.id)} className="text-sm px-3 py-1.5 border border-border rounded-card hover:bg-paper">Cancel</button>}
              {c.status === "approved" && c.receipt_group_id && !!me.permissions.download_receipts && <button onClick={() => receipt(c)} className="text-sm px-3 py-1.5 border border-border rounded-card hover:bg-paper">Receipt</button>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function PortalPayPage() {
  const { code } = useParams<{ code: string }>();
  return <PortalShell code={code} active="pay">{(me) => (me.permissions.submit_payment ? <Pay code={code} me={me} /> : <p className="text-sm text-ink/60">Your property office hasn't enabled this for your account.</p>)}</PortalShell>;
}
