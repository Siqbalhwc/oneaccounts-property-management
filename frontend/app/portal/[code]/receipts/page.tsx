"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalAuthError, PortalReceipt, downloadPortalPdf, formatDate, formatMoney, formatMonth, portalRequest } from "@/lib/portalApi";

function Receipts({ code }: { code: string }) {
  const router = useRouter();
  const [list, setList] = useState<PortalReceipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = (e: any) => (e instanceof PortalAuthError ? router.replace(`/portal/${code}/login`) : setError(e.message));

  useEffect(() => {
    portalRequest<{ receipts: PortalReceipt[] }>(code, "/portal/receipts").then((r) => setList(r.receipts)).catch(guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function open(r: PortalReceipt) {
    setError(null);
    try { await downloadPortalPdf(code, `/portal/receipts/${r.receipt_id}/pdf`, `receipt_${r.date}.pdf`); } catch (e) { guard(e); }
  }

  if (!list) return <p className="text-sm text-ink/50">{error ?? "Loading…"}</p>;
  return (
    <>
      <h1 className="font-display text-2xl font-semibold">My receipts</h1>
      {error && <p className="text-sm text-stamp-red">{error}</p>}
      {list.length === 0 ? <p className="text-sm text-ink/60">You don't have any receipts yet.</p> : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.receipt_id} className="card p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium figures">{formatMoney(r.amount)}</p>
                <p className="text-xs text-ink/55">{formatDate(r.date)} · {r.method === "cash" ? "Cash" : r.method === "bank_transfer" ? "Bank transfer" : r.method}{r.invoice_months.length ? ` · ${r.invoice_months.map(formatMonth).join(", ")}` : ""}</p>
              </div>
              <button onClick={() => open(r)} className="text-sm px-3 py-1.5 border border-border rounded-card hover:bg-paper">Download PDF</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function PortalReceiptsPage() {
  const { code } = useParams<{ code: string }>();
  return <PortalShell code={code} active="receipts">{(me) => (me.permissions.download_receipts ? <Receipts code={code} /> : <p className="text-sm text-ink/60">Your property office hasn't enabled this for your account.</p>)}</PortalShell>;
}
