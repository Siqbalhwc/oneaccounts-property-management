"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalAuthError, PortalLedgerRow, formatDate, formatMoney, portalRequest } from "@/lib/portalApi";

function Ledger({ code }: { code: string }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<{ rows: PortalLedgerRow[]; closing_balance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams();
    if (from) q.set("date_from", from);
    if (to) q.set("date_to", to);
    try { setData(await portalRequest(code, `/portal/ledger?${q.toString()}`)); }
    catch (e: any) { if (e instanceof PortalAuthError) router.replace(`/portal/${code}/login`); else setError(e.message); }
  }, [code, from, to, router]);
  useEffect(() => { load(); }, [load]);

  const closing = data?.closing_balance ?? 0;
  const input = "px-3 py-2 text-sm bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark";
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">My ledger</h1>
          <p className="text-sm text-ink/55 mt-1">Your statement of invoices and payments. It is the same record your property office keeps.</p>
        </div>
        <button onClick={() => window.print()} className="px-4 py-2 rounded-card border border-border text-sm hover:bg-paper no-print">Print</button>
      </div>

      <div className="flex flex-wrap gap-3 items-end no-print">
        <div><label className="text-xs text-ink/55 block mb-1">From</label><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="text-xs text-ink/55 block mb-1">To</label><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {(from || to) && <button className="px-3 py-2 text-sm underline text-ink/60" onClick={() => { setFrom(""); setTo(""); }}>Clear</button>}
      </div>

      {error && <p className="text-sm text-stamp-red">{error}</p>}
      {!data && !error && <p className="text-sm text-ink/50">Loading…</p>}
      {data && (
        <>
          <div className="card p-5">
            <p className="text-xs uppercase tracking-wider text-ink/45">{closing < 0 ? "Advance (credit) balance" : "Balance due"}</p>
            <p className="font-display text-3xl font-semibold figures mt-1">{formatMoney(Math.abs(closing))}</p>
          </div>

          {data.rows.length === 0 ? <p className="text-sm text-ink/60">There are no entries for this period.</p> : (
            <>
              <div className="hidden md:block card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-ink/50 text-xs uppercase tracking-wider border-b border-border"><th className="p-3">Date</th><th className="p-3">Description</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3 text-right">Balance</th></tr></thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="p-3 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="p-3">{r.is_opening ? <span className="font-medium">Opening balance</span> : r.description ?? "—"}</td>
                        <td className="p-3 text-right figures">{r.debit ? formatMoney(r.debit) : ""}</td>
                        <td className="p-3 text-right figures">{r.credit ? formatMoney(r.credit) : ""}</td>
                        <td className="p-3 text-right figures font-medium">{formatMoney(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-2">
                {data.rows.map((r, i) => (
                  <div key={i} className="card p-3 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-ink/55">{formatDate(r.date)}</span><span className="figures font-medium">{formatMoney(r.balance)}</span></div>
                    <p className="mt-1">{r.is_opening ? "Opening balance" : r.description ?? "—"}</p>
                    {(r.debit > 0 || r.credit > 0) && <p className="text-xs text-ink/55 mt-1 figures">{r.debit > 0 ? `Charged ${formatMoney(r.debit)}` : `Paid ${formatMoney(r.credit)}`}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function PortalLedgerPage() {
  const { code } = useParams<{ code: string }>();
  return <PortalShell code={code} active="ledger">{(me) => (me.permissions.view_ledger ? <Ledger code={code} /> : <p className="text-sm text-ink/60">Your property office hasn't enabled this for your account.</p>)}</PortalShell>;
}
