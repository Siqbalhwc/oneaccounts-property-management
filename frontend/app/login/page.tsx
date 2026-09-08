"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { api } from "@/lib/api";
import { friendlyAuthError } from "@/lib/authErrors";
import { Field, EmailInput, PasswordInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { BrandPanel, BrandPanelMobileHeader } from "@/components/marketing/BrandPanel";
import { ContactFooter } from "@/components/marketing/ContactFooter";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setBlockedMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError(friendlyAuthError(error.message));
      return;
    }

    // Password was correct -- now record the attempt and find out whether
    // this account/company actually has access yet (it may be pending
    // approval, or suspended). This is the ONE place that can tell the
    // difference, since a pending/suspended session can't read its own
    // company row under RLS to figure that out itself.
    try {
      const result = await api.post<{ access_status: string; message: string }>("/auth/log-login");
      if (result.access_status !== "active") {
        await supabase.auth.signOut();
        setBlockedMessage(result.message);
        setLoading(false);
        return;
      }
    } catch {
      // If the status check itself fails (network hiccup), fall through to
      // the dashboard -- it does the same check again on load and will
      // catch anything real. Never let a logging failure lock someone out.
    }

    setLoading(false);
    router.push("/");
  }

  return (
    <div className="min-h-screen flex bg-paper">
      <BrandPanel />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <BrandPanelMobileHeader />

          <form onSubmit={handleSubmit} className="card p-6 sm:p-7 space-y-4">
            <div className="hidden lg:block mb-1">
              <p className="text-[11px] tracking-[0.1em] text-brass-dark font-medium">ONEACCOUNTS</p>
              <h1 className="font-display text-xl font-semibold text-ink mt-1">Welcome back</h1>
              <p className="text-sm text-ink/55 mt-1">Sign in to Properties Management.</p>
            </div>

            <Field label="Email">
              <EmailInput
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
              />
            </Field>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-sm font-medium text-ink">Password</label>
                <Link href="/forgot-password" className="text-xs text-accent hover:underline">
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-stamp-red">{error}</p>}
            {blockedMessage && (
              <p className="text-sm text-brass-dark bg-brass/10 border border-brass/25 rounded-card px-3 py-2.5">
                {blockedMessage}
              </p>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>

            <p className="text-xs text-center text-ink/45 pt-1">
              New to Properties Management?{" "}
              <Link href="/signup" className="text-accent hover:underline">
                Create an account
              </Link>
            </p>

            <ContactFooter />
          </form>
        </div>
      </div>
    </div>
  );
}
