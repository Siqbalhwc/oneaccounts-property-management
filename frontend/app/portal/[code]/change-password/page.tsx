"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalAuthError, PortalMe, portalRequest, portalToken } from "@/lib/portalApi";

export default function PortalChangePasswordPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    portalRequest<PortalMe>(code, "/portal/me").then(setMe).catch((e) => {
      if (e instanceof PortalAuthError) router.replace(`/portal/${code}/login`);
      else setError(e.message);
    });
  }, [code, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== again) { setError("The two new passwords don't match."); return; }
    setLoading(true);
    try {
      const r = await portalRequest<{ token: string }>(code, "/portal/change-password", {
        method: "POST", body: JSON.stringify({ current_password: current, new_password: next }),
      });
      portalToken.set(code, r.token);
      router.replace(`/portal/${code}`);
    } catch (err: any) {
      if (err instanceof PortalAuthError) { router.replace(`/portal/${code}/login`); return; }
      setError(err.message);
      setLoading(false);
    }
  }

  const input = "w-full px-3 py-2.5 text-base bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark focus:ring-1 focus:ring-brass-dark";
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-paper px-4 py-8">
      <form onSubmit={submit} className="card w-full max-w-md p-6 sm:p-8 space-y-5 border-t-[3px] border-t-brass">
        <div>
          <p className="text-[11px] tracking-[0.1em] text-brass-dark font-medium">{me?.company_name?.toUpperCase() ?? "TENANT PORTAL"}</p>
          <h1 className="font-display text-2xl font-semibold text-ink mt-1">Choose your own password</h1>
          <p className="text-sm text-ink/55 mt-1">{me ? `Welcome, ${me.tenant_name}. ` : ""}For your security, please replace the temporary password you were given.</p>
        </div>
        <div><label className="text-sm font-medium block mb-1.5">Temporary password</label><input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></div>
        <div><label className="text-sm font-medium block mb-1.5">New password (at least 8 characters)</label><input className={input} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} /></div>
        <div><label className="text-sm font-medium block mb-1.5">Repeat new password</label><input className={input} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required minLength={8} /></div>
        {error && <p className="text-sm text-stamp-red" role="alert">{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-3 rounded-card bg-ink text-paper font-medium disabled:opacity-60">{loading ? "Saving…" : "Save and continue"}</button>
      </form>
    </main>
  );
}
