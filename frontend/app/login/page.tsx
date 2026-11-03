"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, CircleAlert } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { api } from "@/lib/api";
import { friendlyAuthError } from "@/lib/authErrors";
import { OaAuthFrame, OaHelp, OaPasswordField, OaTextField, DEMO_URL } from "@/components/marketing/OaAuthFrame";

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
    <OaAuthFrame>
      <div className="oa-secure"><Lock size={13} aria-hidden="true" /> Secure sign-in</div>
      <h2 className="oa-title">Sign in to your workspace</h2>
      <p className="oa-sub">
        Welcome back to <strong>OneAccounts Property Management</strong>.
      </p>

      {error && (
        <div className="oa-msg oa-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div>{error}</div>
        </div>
      )}
      {blockedMessage && (
        <div className="oa-msg oa-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div>{blockedMessage}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
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
        <OaPasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="Enter your password"
          autoComplete="current-password"
        />

        <div className="oa-row" style={{ justifyContent: "flex-end" }}>
          <Link href="/forgot-password" className="oa-forgot">Forgot password?</Link>
        </div>

        <button type="submit" className="oa-btn" disabled={loading}>
          {loading ? (
            <>
              <span className="oa-spinner" aria-hidden="true" /> Please wait…
            </>
          ) : (
            "Sign in"
          )}
        </button>

        <div className="oa-secure-note"><Lock size={12} aria-hidden="true" /> Encrypted connection</div>
      </form>

      <div className="oa-switch-row">
        <Link href="/signup" className="oa-switch">
          New to Property Management? <strong>Create an account</strong>
        </Link>
      </div>

      <div className="oa-or">or</div>
      <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="oa-trial">
        Request a demo
        <span className="oa-trial-tag">ON WHATSAPP</span>
      </a>
      <p className="oa-note">We will walk you through it with your own buildings.</p>

      <p className="oa-prop">
        Running a trading, NGO or service business?{" "}
        <a href="https://app.oneaccountsbysiqbal.com/login">Sign in to OneAccounts</a>
      </p>

      <OaHelp />
    </OaAuthFrame>
  );
}
