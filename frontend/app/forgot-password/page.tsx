"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { friendlyAuthError } from "@/lib/authErrors";
import { Field, EmailInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { IconArrowLeft } from "@/components/ui/icons";
import { BrandPanel, BrandPanelMobileHeader } from "@/components/marketing/BrandPanel";
import { ContactFooter } from "@/components/marketing/ContactFooter";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(friendlyAuthError(error.message));
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex bg-paper">
      <BrandPanel />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <BrandPanelMobileHeader />

          <div className="card p-6 sm:p-7 space-y-4">
            <div className="mb-1">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-xs text-ink/50 hover:text-ink transition-colors mb-3"
              >
                <IconArrowLeft size={14} />
                Back to sign in
              </Link>
              <h1 className="font-display text-xl font-semibold text-ink">Reset your password</h1>
              <p className="text-sm text-ink/55 mt-1">
                {sent
                  ? "Check your inbox for the reset link."
                  : "Enter the email on your account and we'll send you a link to reset it."}
              </p>
            </div>

            {sent ? (
              <p className="text-sm text-ink/70 bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2.5">
                We've sent a reset link to <span className="font-medium">{email}</span>. It may take a
                minute to arrive — check spam if you don't see it.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
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
                {error && <p className="text-sm text-stamp-red">{error}</p>}
                <Button type="submit" className="w-full" loading={loading}>
                  {loading ? "Sending…" : "Send reset link"}
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
