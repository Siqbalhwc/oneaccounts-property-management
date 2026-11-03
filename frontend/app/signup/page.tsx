"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { postPublic, api } from "@/lib/api";
import { friendlyAuthError } from "@/lib/authErrors";
import { CircleAlert, MailCheck } from "lucide-react";
import { OaAuthFrame, OaHelp, OaPasswordField, OaTextField } from "@/components/marketing/OaAuthFrame";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    company_name: "",
    full_name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await postPublic("/signup", form);
      // Sign them in with the credentials they just created so we can
      // check + log their access status -- but every new company starts
      // 'pending', so this will NOT land them in the dashboard yet.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (signInError) throw signInError;

      const result = await api.post<{ access_status: string; message: string }>("/auth/log-login");
      if (result.access_status !== "active") {
        await supabase.auth.signOut();
        setPendingApproval(true);
        setLoading(false);
        return;
      }
      router.push("/");
    } catch (err: any) {
      setError(friendlyAuthError(err.message));
    } finally {
      setLoading(false);
    }
  }

  if (pendingApproval) {
    return (
      <OaAuthFrame>
        <h2 className="oa-title">Account created</h2>
        <p className="oa-sub">Thank you for signing up.</p>
        <div className="oa-confirm" role="status">
          <MailCheck size={28} aria-hidden="true" />
          <h2>Waiting for approval</h2>
          <p>
            Your company has been set up, but a platform admin needs to approve it
            before you can sign in. You&apos;ll be able to log in as soon as that
            happens — no further action needed from you right now.
          </p>
        </div>
        <div className="oa-switch-row">
          <Link href="/login" className="oa-switch"><strong>Back to sign in</strong></Link>
        </div>
        <OaHelp />
      </OaAuthFrame>
    );
  }

  return (
    <OaAuthFrame>
      <h2 className="oa-title">Create your account</h2>
      <p className="oa-sub">
        Set up your own company — completely separate from anyone else&apos;s data.
      </p>

      {error && (
        <div className="oa-msg oa-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <OaTextField
          id="company"
          label="Company name"
          value={form.company_name}
          onChange={(v) => setForm({ ...form, company_name: v })}
          placeholder="e.g. Green Valley Estates"
          autoFocus
        />
        <OaTextField
          id="full-name"
          label="Your full name"
          value={form.full_name}
          onChange={(v) => setForm({ ...form, full_name: v })}
          autoComplete="name"
        />
        <OaTextField
          id="email"
          label="Email address"
          type="email"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          placeholder="you@company.com"
          autoComplete="email"
        />
        <OaPasswordField
          id="password"
          label="Password"
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
          placeholder="Create a password"
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
        />

        <button type="submit" className="oa-btn" disabled={loading}>
          {loading ? (
            <>
              <span className="oa-spinner" aria-hidden="true" /> Creating your company…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <div className="oa-switch-row">
        <Link href="/login" className="oa-switch">
          Already have an account? <strong>Sign in</strong>
        </Link>
      </div>

      <OaHelp />
    </OaAuthFrame>
  );
}
