"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalMe, formatDate, formatMoney, portalRequest } from "@/lib/portalApi";

type Summary = { balance: number | null; unpaid_count: number | null; overdue_count: number | null; next_due: { due_date: string; balance: number } | null };

function Home({ code, me }: { code: string; me: PortalMe }) {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => { portalRequest<Summary>(code, "/portal/summary").then(setS).catch(() => setS(null)); }, [code]);

  const soon = [{ key: "submit_repair", title: "Repair request", text: "Report a problem for maintenance." }].filter((t) => me.permissions[t.key]);

  return (
    <>
      <div>
        <h1 className="font-display text-2xl font-semibold">Welcome, {me.tenant_name}</h1>
        <p className="text-sm text-ink/55 mt-1">Signed in with CNIC <span className="figures">{me.masked_username}</span></p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {me.permissions.view_ledger && (
          <Link href={`/portal/${code}/ledger`} className="card p-5 block hover:border-brass-dark">
            <p className="text-xs uppercase tracking-wider text-ink/45">Balance</p>
            <p className="font-display text-2xl font-semibold mt-1 figures">{s?.balance == null ? "—" : s.balance < 0 ? `${formatMoney(-s.balance)} advance` : formatMoney(s.balance)}</p>
            <p className="text-sm text-ink/55 mt-1">Open your ledger</p>
          </Link>
        )}
        {me.permissions.view_invoices && (
          <Link href={`/portal/${code}/invoices`} className="card p-5 block hover:border-brass-dark">
            <p className="text-xs uppercase tracking-wider text-ink/45">Invoices to pay</p>
            <p className="font-display text-2xl font-semibold mt-1">{s?.unpaid_count ?? "—"}</p>
            <p className="text-sm text-ink/55 mt-1">
              {s?.overdue_count ? `${s.overdue_count} overdue. ` : ""}
              {s?.next_due ? `Next due ${formatDate(s.next_due.due_date)}` : "View your invoices"}
            </p>
          </Link>
        )}
        {me.permissions.submit_payment && (
          <Link href={`/portal/${code}/pay`} className="card p-5 block hover:border-brass-dark">
            <h2 className="font-display text-lg font-semibold">I have paid</h2>
            <p className="text-sm text-ink/60 mt-1">Tell your property office about a cash or bank payment.</p>
          </Link>
        )}
        {me.permissions.download_receipts && (
          <Link href={`/portal/${code}/receipts`} className="card p-5 block hover:border-brass-dark">
            <h2 className="font-display text-lg font-semibold">My receipts</h2>
            <p className="text-sm text-ink/60 mt-1">Download receipts for your payments.</p>
          </Link>
        )}
        {soon.map((t) => (
          <div key={t.key} className="card p-5 opacity-80">
            <h2 className="font-display text-lg font-semibold">{t.title}</h2>
            <p className="text-sm text-ink/60 mt-1">{t.text}</p>
            <p className="text-xs text-ink/40 mt-3">Coming in the next update</p>
          </div>
        ))}
      </div>
      {!me.permissions.view_ledger && !me.permissions.view_invoices && !me.permissions.submit_payment && !me.permissions.download_receipts && soon.length === 0 && (
        <p className="text-sm text-ink/60">Your property office hasn't enabled any portal features for your account yet.</p>
      )}
    </>
  );
}

export default function PortalHomePage() {
  const { code } = useParams<{ code: string }>();
  return <PortalShell code={code} active="home">{(me) => <Home code={code} me={me} />}</PortalShell>;
}
