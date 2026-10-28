"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalAuthError, PortalMe, portalRequest, portalToken } from "@/lib/portalApi";

const TILES: { key: string; title: string; text: string }[] = [
  { key: "view_invoices", title: "My invoices", text: "Your monthly invoices will appear here." },
  { key: "view_ledger", title: "My ledger", text: "Your statement of invoices and payments." },
  { key: "submit_payment", title: "I have paid", text: "Tell your property office about a cash or bank payment." },
  { key: "submit_repair", title: "Repair request", text: "Report a problem for maintenance." },
  { key: "download_receipts", title: "My receipts", text: "Download receipts for your payments." },
];

export default function PortalHomePage() {
  const { code } = useParams<{ code: string }>();
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

  const allowed = TILES.filter((t) => me.permissions[t.key]);
  return (
    <div className="min-h-screen w-full bg-paper">
      <header className="w-full bg-paper-card border-b border-border">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {me.logo_url && <img src={me.logo_url} alt="" className="h-9 w-9 object-contain rounded" />}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-[0.1em] text-brass-dark font-medium truncate">{me.company_name.toUpperCase()}</p>
            <p className="text-sm font-medium truncate">{me.tenant_name}</p>
          </div>
          <button onClick={signOut} className="text-sm px-3 py-2 border border-border rounded-card hover:bg-paper">Sign out</button>
        </div>
      </header>
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Welcome, {me.tenant_name}</h1>
          <p className="text-sm text-ink/55 mt-1">Signed in with CNIC <span className="figures">{me.masked_username}</span></p>
        </div>
        {allowed.length === 0 ? (
          <p className="text-sm text-ink/60">Your property office hasn't enabled any portal features for your account yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allowed.map((t) => (
              <div key={t.key} className="card p-5">
                <h2 className="font-display text-lg font-semibold">{t.title}</h2>
                <p className="text-sm text-ink/60 mt-1">{t.text}</p>
                <p className="text-xs text-ink/40 mt-3">Coming in the next update</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
