"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { friendlyAuthError } from "@/lib/authErrors";
import { CircleAlert, CircleCheck } from "lucide-react";
import { OaAuthFrame, OaHelp, OaPasswordField } from "@/components/marketing/OaAuthFrame";

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
    <OaAuthFrame>
      <h2 className="oa-title">Set a new password</h2>
      <p className="oa-sub">
        {done ? "Password updated — taking you in now…" : "Choose a new password for your account."}
      </p>

      {done && (
        <div className="oa-msg oa-success" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          <div>Your password has been changed.</div>
        </div>
      )}

      {!done && (
        <form onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="oa-msg oa-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <div>{error}</div>
            </div>
          )}
          <OaPasswordField
            id="new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            placeholder="Choose a new password"
            autoComplete="new-password"
            autoFocus
            minLength={8}
            disabled={!ready}
            hint="At least 8 characters."
          />
          <OaPasswordField
            id="confirm-password"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Type it again"
            autoComplete="new-password"
            minLength={8}
            disabled={!ready}
          />
          {!ready && !error && <p className="oa-info">Verifying your reset link…</p>}
          <button type="submit" className="oa-btn" disabled={loading || !ready}>
            {loading ? (
              <>
                <span className="oa-spinner" aria-hidden="true" /> Updating…
              </>
            ) : (
              "Update password"
            )}
          </button>
        </form>
      )}

      <OaHelp />
    </OaAuthFrame>
  );
}
