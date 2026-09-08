"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { postPublic, api } from "@/lib/api";
import { friendlyAuthError } from "@/lib/authErrors";
import { Field, Input, EmailInput, PasswordInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { BrandPanel, BrandPanelMobileHeader } from "@/components/marketing/BrandPanel";
import { ContactFooter } from "@/components/marketing/ContactFooter";

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
      <div className="min-h-screen flex bg-paper">
        <BrandPanel />
        <div className="flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm">
            <BrandPanelMobileHeader />
            <div className="card p-6 sm:p-7 space-y-4 text-center">
              <h1 className="font-display text-xl font-semibold text-ink">Account created</h1>
              <p className="text-sm text-ink/60">
                Your company has been set up, but a platform admin needs to approve it
                before you can sign in. You&apos;ll be able to log in as soon as that
                happens — no further action needed from you right now.
              </p>
              <Link href="/login" className="text-sm text-accent hover:underline inline-block pt-2">
                Back to sign in
              </Link>
              <ContactFooter />
            </div>
          </div>
        </div>
      </div>
    );
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
              <h1 className="font-display text-xl font-semibold text-ink mt-1">Create your account</h1>
              <p className="text-sm text-ink/55 mt-1">
                Set up your own company — completely separate from anyone else&apos;s data.
              </p>
            </div>
            <p className="lg:hidden text-sm text-ink/60 -mt-1 mb-1">
              Set up your own company — completely separate from anyone else&apos;s data.
            </p>

            <Field label="Company name">
              <Input
                required
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                placeholder="e.g. Green Valley Estates"
              />
            </Field>
            <Field label="Your full name">
              <Input
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <EmailInput
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com"
              />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <PasswordInput
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>

            {error && <p className="text-sm text-stamp-red">{error}</p>}

            <Button type="submit" className="w-full" loading={loading}>
              {loading ? "Creating your company…" : "Create account"}
            </Button>

            <p className="text-xs text-center text-ink/45 pt-1">
              Already have an account?{" "}
              <Link href="/login" className="text-accent hover:underline">
                Sign in
              </Link>
            </p>

            <ContactFooter />
          </form>
        </div>
      </div>
    </div>
  );
}
