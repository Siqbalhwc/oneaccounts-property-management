"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PortalAuthError, PortalMe, portalRequest, portalToken } from "@/lib/portalApi";

/** Common frame for every signed-in tenant page: signs the tenant in (or sends them to the sign-in
 *  page), shows the header and navigation, and hands the tenant's details to the page. */
export function PortalShell({ code, active, children }: { code: string; active: "home" | "invoices" | "ledger" | "pay" | "receipts" | "repairs"; children: (me: PortalMe) => React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalRequest<PortalMe>(code, "/portal/me")
      .then((m) => (m.must_change_password ? router.replace(`/portal/${code}/change-password`) : setMe(m)))
      .catch((e) => (e instanceof PortalAuthError ? router.replace(`/portal/${code}/login`) : setError(e.message)));
  }, [code, router]);

  async function signOut() {
    try { await portalRequest(code, "/portal/logout", { method: "POST" }); } catch { /* already signed out */ }
    portalToken.clear(code);
    router.replace(`/portal/${code}/login`);
  }

  if (error) return <main className="min-h-screen flex items-center justify-center px-4"><p className="text-sm text-stamp-red">{error}</p></main>;
  if (!me) return <main className="min-h-screen flex items-center justify-center"><p className="text-sm text-ink/50">Loading…</p></main>;

  const tabs = [
    { key: "home", label: "Home", href: `/portal/${code}`, show: true },
    { key: "invoices", label: "Invoices", href: `/portal/${code}/invoices`, show: !!me.permissions.view_invoices },
    { key: "ledger", label: "Ledger", href: `/portal/${code}/ledger`, show: !!me.permissions.view_ledger },
    { key: "pay", label: "I have paid", href: `/portal/${code}/pay`, show: !!me.permissions.submit_payment },
    { key: "receipts", label: "Receipts", href: `/portal/${code}/receipts`, show: !!me.permissions.download_receipts },
    { key: "repairs", label: "Repairs", href: `/portal/${code}/repairs`, show: !!me.permissions.submit_repair },
  ].filter((t) => t.show);

  return (
    <div className="min-h-screen w-full bg-paper">
      <header className="w-full bg-paper-card border-b border-border no-print">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {me.logo_url && <img src={me.logo_url} alt="" className="h-9 w-9 object-contain rounded" />}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-[0.1em] text-brass-dark font-medium truncate">{me.company_name.toUpperCase()}</p>
            <p className="text-sm font-medium truncate">{me.tenant_name}</p>
          </div>
          <button onClick={signOut} className="text-sm px-3 py-2 border border-border rounded-card hover:bg-paper">Sign out</button>
        </div>
        <nav className="w-full max-w-6xl mx-auto px-2 sm:px-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <Link key={t.key} href={t.href}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 ${active === t.key ? "border-brass-dark text-ink font-medium" : "border-transparent text-ink/55 hover:text-ink"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">{children(me)}</main>
    </div>
  );
}
