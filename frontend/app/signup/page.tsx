"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { postPublic } from "@/lib/api";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await postPublic("/signup", form);
      // Sign them straight in with the credentials they just created.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (signInError) throw signInError;
      router.push("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ledger px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="font-display text-2xl font-semibold text-paper">Ledger</p>
          <p className="text-sm text-paper/50 mt-1">Property Management</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <p className="text-sm text-ink/60 -mt-1 mb-2">
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
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating your company…" : "Create account"}
          </Button>
          <p className="text-xs text-center text-ink/45 pt-1">
            Already have an account?{" "}
            <Link href="/login" className="text-ledger hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
