"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Eye,
  EyeOff,
  Banknote,
  ShieldCheck,
  FileText,
  KeyRound,
  MessageCircle,
  Phone,
  Mail,
  Globe,
} from "lucide-react";
import { OA_AUTH_CSS } from "@/components/marketing/oaAuthStyles";
import { CONTACT_EMAIL, WHATSAPP_DIGITS, WEBSITE_URL } from "@/components/marketing/ContactFooter";
import logo from "../../app/logo-transparent-master.png";

/**
 * Shared frame for every Property auth page (login, signup, forgot password,
 * reset password). Same look and layout as the OneAccounts ERP login
 * (app.oneaccountsbysiqbal.com) so the two products read as one.
 * Each page passes only its own card content as children.
 */

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

export const DEMO_URL =
  "https://wa.me/" + WHATSAPP_DIGITS + "?text=Hello%20OneAccounts%2C%20I%20would%20like%20a%20demo%20of%20Property%20Management.";

const EXTRA_CSS = `
.oa-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-soft);text-decoration:none;margin-bottom:6px}
.oa-back:hover{color:var(--navy);text-decoration:underline}
.oa-hint{margin:5px 0 0;font-size:12px;color:var(--ink-soft)}
.oa-info{font-size:13.5px;line-height:1.55;color:var(--ink-soft);margin:0 0 16px}
`;

export function OaAuthFrame({ children }: { children: React.ReactNode }) {
  const [activeTopic, setActiveTopic] = useState<Topic>("rent");
  const ex = EXAMPLES[activeTopic];

  return (
    <>
      <style>{OA_AUTH_CSS}</style>
      <style>{EXTRA_CSS}</style>

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

        {/* RIGHT: page-specific card */}
        <section className="oa-right" aria-label="Account">
          <div className="oa-card">{children}</div>
        </section>
      </main>
    </>
  );
}

/** "Need help?" block shown at the bottom of every auth card. */
export function OaHelp() {
  return (
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
  );
}

/** Text input with the label styling used on every auth page. */
export function OaTextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
}) {
  return (
    <div className="oa-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        className="oa-input"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        required={props.required ?? true}
      />
    </div>
  );
}

/** Password input with the Show/Hide toggle used on the ERP login. */
export function OaPasswordField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  minLength?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="oa-field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="oa-input-wrap">
        <input
          id={props.id}
          type={show ? "text" : "password"}
          className="oa-input has-toggle"
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete}
          autoFocus={props.autoFocus}
          minLength={props.minLength}
          disabled={props.disabled}
          required
        />
        <button type="button" className="oa-toggle" aria-pressed={show} onClick={() => setShow((p) => !p)}>
          {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {props.hint && <p className="oa-hint">{props.hint}</p>}
    </div>
  );
}
