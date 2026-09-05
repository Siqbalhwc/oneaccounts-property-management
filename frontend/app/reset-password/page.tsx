"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { friendlyAuthError } from "@/lib/authErrors";
import { Field, PasswordInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { BrandPanel, BrandPanelMobileHeader } from "@/components/marketing/BrandPanel";
import { ContactFooter } from "@/components/marketing/ContactFooter";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // supabase-js v2 reads the recovery token out of the URL fragment on load
  // and turns it into a real (temporary) session -- PASSWORD_RECOVERY fires
  // once that's ready. Until then, the form stays disabled rather than
  // letting someone submit against a session that isn't there yet.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Fallback: if a session already exists by the time this mounts (e.g.
    // fast reload), don't leave the form stuck waiting for an event that
    // already fired.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(friendlyAuthError(error.message));
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/"), 1500);
  }

  return (
    <div className="min-h-screen flex bg-paper">
      <BrandPanel />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <BrandPanelMobileHeader />

          <div className="card p-6 sm:p-7 space-y-4">
            <div className="mb-1">
              <h1 className="font-display text-xl font-semibold text-ink">Set a new password</h1>
              <p className="text-sm text-ink/55 mt-1">
                {done ? "Password updated — taking you in now…" : "Choose a new password for your account."}
              </p>
            </div>

            {!done && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="New password" hint="At least 8 characters.">
                  <PasswordInput
                    autoFocus
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={!ready}
                  />
                </Field>
                <Field label="Confirm new password">
                  <PasswordInput
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={!ready}
                  />
                </Field>
                {!ready && !error && (
                  <p className="text-xs text-ink/45">Verifying your reset link…</p>
                )}
                {error && <p className="text-sm text-stamp-red">{error}</p>}
                <Button type="submit" className="w-full" loading={loading} disabled={!ready}>
                  {loading ? "Updating…" : "Update password"}
                </Button>
              </form>
            )}

            <ContactFooter />
          </div>
        </div>
      </div>
    </div>
  );
}
