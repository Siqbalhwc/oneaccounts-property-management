"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalAuthError, PortalInvoice, PortalMe, downloadPortalPdf, formatDate, formatMoney, formatMonth, portalRequest } from "@/lib/portalApi";

const PAGE = 24;
const BADGE: Record<PortalInvoice["status"], { text: string; cls: string }> = {
  paid: { text: "Paid", cls: "bg-green-100 text-green-800" },
  partial: { text: "Partly paid", cls: "bg-amber-100 text-amber-800" },
  overdue: { text: "Overdue", cls: "bg-red-100 text-red-800" },
  due: { text: "Due", cls: "bg-slate-100 text-slate-700" },
};

function InvoiceCard({ code, me, inv, onChanged }: { code: string; me: PortalMe; inv: PortalInvoice; onChanged: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: any) => (e instanceof PortalAuthError ? router.replace(`/portal/${code}/login`) : setError(e.message));

  async function pdf() {
    setError(null);
    try { await downloadPortalPdf(code, `/portal/invoices/${inv.id}/pdf`, `invoice_${inv.invoice_month.slice(0, 7)}.pdf`); } catch (e) { fail(e); }
  }
  async function send() {
    setBusy(true); setError(null);
    try {
      await portalRequest(code, `/portal/invoices/${inv.id}/change-request`, { method: "POST", body: JSON.stringify({ message: note }) });
      setAsking(false); setNote(""); onChanged();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const badge = BADGE[inv.status];
  const canAsk = inv.can_request_change && !!me.permissions.request_invoice_change;
  return (
    <div className="card p-4 sm:p-5">
      <button className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-2" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">{formatMonth(inv.invoice_month)}</p>
          <p className="text-xs text-ink/55">
            Due {formatDate(inv.due_date)}
            {inv.room ? ` · ${[inv.room.building, `${me.unit} ${inv.room.number}`].filter(Boolean).join(" — ")}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="figures font-semibold">{formatMoney(inv.total)}</p>
          {inv.status !== "paid" && inv.balance > 0 && inv.balance !== inv.total && <p className="text-xs text-ink/55">Balance {formatMoney(inv.balance)}</p>}
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {inv.items.map((it, i) => (
                  <tr key={i} className="border-b border-border/60"><td className="py-1.5">{it.label}</td><td className="py-1.5 text-right figures">{formatMoney(it.amount)}</td></tr>
                ))}
                <tr><td className="py-1.5 font-medium">Total</td><td className="py-1.5 text-right figures font-medium">{formatMoney(inv.total)}</td></tr>
                {inv.paid > 0 && <tr><td className="py-1.5 text-ink/60">Paid so far</td><td className="py-1.5 text-right figures text-ink/60">{formatMoney(inv.paid)}</td></tr>}
              </tbody>
            </table>
          </div>

          {inv.request && (
            <div className="text-sm bg-paper border border-border rounded-card px-3 py-2">
              <p className="font-medium">{inv.request.status === "open" ? "Change requested — waiting for your property office" : inv.request.status === "resolved" ? "Your request was handled" : "Your request was not accepted"}</p>
              <p className="text-ink/60 mt-0.5">“{inv.request.message}”</p>
              {inv.request.reply && <p className="mt-1"><span className="text-ink/50">Reply:</span> {inv.request.reply}</p>}
            </div>
          )}

          {asking && (
            <div className="space-y-2">
              <label className="text-sm font-medium block">What should change?</label>
              <textarea className="w-full px-3 py-2 text-base bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark" rows={3} maxLength={500}
                value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: please remove the parking charge this month" />
              <div className="flex gap-2">
                <button onClick={send} disabled={busy || note.trim().length < 3} className="px-4 py-2 rounded-card bg-ink text-paper text-sm disabled:opacity-50">{busy ? "Sending…" : "Send to office"}</button>
                <button onClick={() => { setAsking(false); setError(null); }} className="px-4 py-2 rounded-card border border-border text-sm">Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-stamp-red">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button onClick={pdf} className="px-4 py-2 rounded-card border border-border text-sm hover:bg-paper">Download PDF</button>
            {inv.status !== "paid" && !!me.permissions.submit_payment && <a href={`/portal/${code}/pay?invoice=${inv.id}`} className="px-4 py-2 rounded-card bg-ink text-paper text-sm">I have paid</a>}
            {canAsk && !asking && <button onClick={() => setAsking(true)} className="px-4 py-2 rounded-card border border-border text-sm hover:bg-paper">Request a change</button>}
          </div>
          {canAsk && !asking && <p className="text-xs text-ink/45">Your invoice stands as shown unless your property office changes it.</p>}
        </div>
      )}
    </div>
  );
}

function Invoices({ code, me }: { code: string; me: PortalMe }) {
  const router = useRouter();
  const [list, setList] = useState<PortalInvoice[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number, replace: boolean) => {
    try {
      const r = await portalRequest<{ invoices: PortalInvoice[] }>(code, `/portal/invoices?limit=${PAGE}&offset=${offset}`);
      setList((prev) => (replace || !prev ? r.invoices : [...prev, ...r.invoices]));
      setMore(r.invoices.length === PAGE);
    } catch (e: any) {
      if (e instanceof PortalAuthError) router.replace(`/portal/${code}/login`); else setError(e.message);
    }
  }, [code, router]);
  useEffect(() => { load(0, true); }, [load]);

  if (error) return <p className="text-sm text-stamp-red">{error}</p>;
  if (!list) return <p className="text-sm text-ink/50">Loading…</p>;
  return (
    <>
      <h1 className="font-display text-2xl font-semibold">My invoices</h1>
      {list.length === 0 ? <p className="text-sm text-ink/60">You don't have any invoices yet.</p> : (
        <div className="space-y-3">
          {list.map((inv) => <InvoiceCard key={inv.id} code={code} me={me} inv={inv} onChanged={() => load(0, true)} />)}
          {more && <button onClick={() => load(list.length, false)} className="px-4 py-2 rounded-card border border-border text-sm hover:bg-paper">Show older invoices</button>}
        </div>
      )}
    </>
  );
}

export default function PortalInvoicesPage() {
  const { code } = useParams<{ code: string }>();
  return <PortalShell code={code} active="invoices">{(me) => (me.permissions.view_invoices ? <Invoices code={code} me={me} /> : <p className="text-sm text-ink/60">Your property office hasn't enabled this for your account.</p>)}</PortalShell>;
}
