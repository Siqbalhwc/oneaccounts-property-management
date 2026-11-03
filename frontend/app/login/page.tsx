"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  Banknote,
  ShieldCheck,
  FileText,
  KeyRound,
  Lock,
  CircleAlert,
  MessageCircle,
  Phone,
  Mail,
  Globe,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { api } from "@/lib/api";
import { friendlyAuthError } from "@/lib/authErrors";
import { OA_AUTH_CSS } from "@/components/marketing/oaAuthStyles";
import { CONTACT_EMAIL, WHATSAPP_DIGITS, WEBSITE_URL } from "@/components/marketing/ContactFooter";
import logo from "../logo-transparent-master.png";

// Same look and layout as the OneAccounts ERP login (app.oneaccountsbysiqbal.com)
// so the two sign-in pages read as one product.

type Topic = "rent" | "deposits" | "owners" | "leases";

const TOPICS: { key: Topic; title: string; desc: string; Icon: typeof Banknote }[] = [
  { key: "rent", title: "Rent & Invoices", desc: "Monthly rent, receipts, arrears", Icon: Banknote },
  { key: "deposits", title: "Security Deposits", desc: "Held, adjusted, refunded", Icon: ShieldCheck },
  { key: "owners", title: "Owner Statements", desc: "Income, expenses, payouts", Icon: FileText },
  { key: "leases", title: "Leases & Move-out", desc: "Renewals and final settlement", Icon: KeyRound },
];

const OUTCOME_LINE: Record<Topic, string> = {
  rent: "Invoice rent, record receipts and see who is behind, building by building.",
  deposits: "Hold deposits in the books and settle them cleanly when a tenant leaves.",
  owners: "Give every owner a clear statement of rent in, expenses out and what is due.",
  leases: "Track lease dates and renewals, and close out a tenancy with an honest final statement.",
};

// Illustrative example (not real customer data)
const EXAMPLES: Record<Topic, { entry: string; rows: [string, string][]; result: [string, string] }> = {
  rent: {
    entry: "Monthly rent collected",
    rows: [["Rent received", "Rs 85,000"], ["Management fee (10%)", "Rs 8,500"]],
    result: ["Owner statement", "Rs 76,500"],
  },
  deposits: {
    entry: "Tenant moves out",
    rows: [["Deposit held", "Rs 100,000"], ["Repair deductions", "Rs 15,000"]],
    result: ["Refund to tenant", "Rs 85,000"],
  },
  owners: {
    entry: "Month-end owner statement",
    rows: [["Rent collected", "Rs 85,000"], ["Building expenses", "Rs 12,000"]],
    result: ["Due to owner", "Rs 73,000"],
  },
  leases: {
    entry: "Lease ends with arrears",
    rows: [["Unpaid rent", "Rs 20,000"], ["Deposit held", "Rs 100,000"]],
    result: ["Net refund", "Rs 80,000"],
  },
};

const DEMO_URL =
  "https://wa.me/" + WHATSAPP_DIGITS + "?text=Hello%20OneAccounts%2C%20I%20would%20like%20a%20demo%20of%20Property%20Management.";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<Topic>("rent");

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

  const ex = EXAMPLES[activeTopic];

  return (
    <>
      <style>{OA_AUTH_CSS}</style>

      <main className="oa-page oa-bg">
        {/* LEFT: brand and topic panel */}
        <section className="oa-left" aria-label="About OneAccounts Property Management">
          <div className="oa-brand">
            <div className="oa-logo-tile">
              <Image src={logo} alt="" width={32} height={32} priority />
            </div>
            <div>
              <div className="oa-brand-name">OneAccounts</div>
              <div className="oa-brand-sub">by Siqbal · Property Management</div>
            </div>
          </div>

          <div className="oa-kicker">Rent and property accounting · Built for Pakistan</div>

          <h1 className="oa-headline">
            Simple by design.
            <span>Professional by nature.</span>
          </h1>

          <p className="oa-label-top">What you manage</p>
          <div className="oa-segs" role="group" aria-label="Choose a topic">
            {TOPICS.map(({ key, title, desc, Icon }) => (
              <button
                type="button"
                key={key}
                className="oa-seg"
                aria-pressed={activeTopic === key}
                onClick={() => setActiveTopic(key)}
              >
                <span className="oa-seg-top"><Icon size={18} strokeWidth={1.8} aria-hidden="true" />{title}</span>
                <span className="oa-seg-desc">{desc}</span>
              </button>
            ))}
          </div>

          <p className="oa-outcome" aria-live="polite">{OUTCOME_LINE[activeTopic]}</p>

          <div className="oa-example">
            <div className="oa-ex-kick">Follow one entry through the books</div>
            <div className="oa-ex-title">{ex.entry}</div>
            {ex.rows.map(([label, value]) => (
              <div className="oa-ex-row" key={label}><span>{label}</span><b>{value}</b></div>
            ))}
            <div className="oa-ex-result"><span>{ex.result[0]}</span><span>{ex.result[1]}</span></div>
            <p className="oa-ex-note">Illustrative figures, not real customer data.</p>
          </div>

          <div className="oa-how">
            <strong>How it works</strong>
            <span><span className="n">1</span>Request a demo</span>
            <span><span className="n">2</span>Add your buildings</span>
            <span><span className="n">3</span>Go live today</span>
          </div>

          <div className="oa-copy">© 2026 OneAccounts by Siqbal. All rights reserved.</div>
        </section>

        {/* RIGHT: sign-in */}
        <section className="oa-right" aria-label="Sign in">
          <div className="oa-card">
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
              <div className="oa-field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  className="oa-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              <div className="oa-field">
                <label htmlFor="password">Password</label>
                <div className="oa-input-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className="oa-input has-toggle"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="oa-toggle"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((p) => !p)}
                  >
                    {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

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

            <div className="oa-help">
              <p>Need help? We&apos;re here for you.</p>
              <div className="oa-contact">
                <a href={`https://wa.me/${WHATSAPP_DIGITS}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={13} strokeWidth={1.8} aria-hidden="true" /> WhatsApp
                </a>
                <a href="tel:+923716853677">
                  <Phone size={13} strokeWidth={1.8} aria-hidden="true" /> +92 371 6853677
                </a>
                <a href={`mailto:${CONTACT_EMAIL}`}>
                  <Mail size={13} strokeWidth={1.8} aria-hidden="true" /> {CONTACT_EMAIL}
                </a>
                <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer">
                  <Globe size={13} strokeWidth={1.8} aria-hidden="true" /> oneaccountsbysiqbal.com
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
