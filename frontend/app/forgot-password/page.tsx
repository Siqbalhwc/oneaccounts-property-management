"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { friendlyAuthError } from "@/lib/authErrors";
import { ArrowLeft, CircleAlert, MailCheck } from "lucide-react";
import { OaAuthFrame, OaHelp, OaTextField } from "@/components/marketing/OaAuthFrame";

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
    <OaAuthFrame>
      <Link href="/login" className="oa-back">
        <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
      </Link>
      <h2 className="oa-title">Reset your password</h2>
      <p className="oa-sub">
        {sent
          ? "Check your inbox for the reset link."
          : "Enter the email on your account and we'll send you a link to reset it."}
      </p>

      {sent ? (
        <div className="oa-confirm" role="status">
          <MailCheck size={28} aria-hidden="true" />
          <h2>Check your email</h2>
          <p>
            We&apos;ve sent a reset link to <strong>{email}</strong>.<br />
            It may take a minute to arrive — check spam if you don&apos;t see it.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="oa-msg oa-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <div>{error}</div>
            </div>
          )}
          <OaTextField
            id="email"
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@company.com"
            autoComplete="email"
            autoFocus
          />
          <button type="submit" className="oa-btn" disabled={loading}>
            {loading ? (
              <>
                <span className="oa-spinner" aria-hidden="true" /> Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </button>
        </form>
      )}

      <OaHelp />
    </OaAuthFrame>
  );
}
