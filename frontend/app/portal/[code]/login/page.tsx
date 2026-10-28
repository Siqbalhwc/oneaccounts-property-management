"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { portalRequest, portalToken } from "@/lib/portalApi";

export default function PortalLoginPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await portalRequest<{ token: string; must_change_password: boolean }>(
        code, "/portal/login", { method: "POST", body: JSON.stringify({ portal_code: code, username, password }) }, false
      );
      portalToken.set(code, r.token);
      router.replace(r.must_change_password ? `/portal/${code}/change-password` : `/portal/${code}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-paper px-4 py-8">
      <form onSubmit={submit} className="card w-full max-w-md p-6 sm:p-8 space-y-5 border-t-[3px] border-t-brass">
        <div>
          <p className="text-[11px] tracking-[0.1em] text-brass-dark font-medium">TENANT PORTAL</p>
          <h1 className="font-display text-2xl font-semibold text-ink mt-1">Sign in</h1>
          <p className="text-sm text-ink/55 mt-1">Use your CNIC and the password given to you by your property office.</p>
        </div>
        <div>
          <label className="text-sm font-medium text-ink block mb-1.5" htmlFor="u">CNIC</label>
          <input id="u" className="w-full px-3 py-2.5 text-base bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark focus:ring-1 focus:ring-brass-dark"
            value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" inputMode="text" placeholder="35202-1234567-1" required />
        </div>
        <div>
          <label className="text-sm font-medium text-ink block mb-1.5" htmlFor="p">Password</label>
          <div className="flex gap-2">
            <input id="p" type={show ? "text" : "password"} className="w-full px-3 py-2.5 text-base bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark focus:ring-1 focus:ring-brass-dark"
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="button" onClick={() => setShow(!show)} className="px-3 text-sm text-ink/60 border border-border rounded-card hover:bg-paper">{show ? "Hide" : "Show"}</button>
          </div>
        </div>
        {error && <p className="text-sm text-stamp-red" role="alert">{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-3 rounded-card bg-ink text-paper font-medium disabled:opacity-60">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
