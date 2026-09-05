"use client";

import { InputHTMLAttributes, SelectHTMLAttributes, LabelHTMLAttributes, useState } from "react";
import { IconMail, IconLock, IconEye, IconEyeOff } from "./icons";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink/50 mt-1">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors ${props.className || ""}`}
    />
  );
}

export function AmountInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40 text-sm figures">
        Rs
      </span>
      <input
        type="number"
        {...props}
        className={`w-full pl-9 pr-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink figures placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors ${props.className || ""}`}
      />
    </div>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors ${props.className || ""}`}
    >
      {props.children}
    </select>
  );
}

/** Email input with a left mail icon -- used on login/signup so the form
 * reads at a glance instead of being two identical-looking text boxes. */
export function EmailInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35 pointer-events-none">
        <IconMail size={16} />
      </span>
      <input
        type="email"
        {...props}
        className={`w-full pl-9 pr-3 py-2 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors ${props.className || ""}`}
      />
    </div>
  );
}

/** Password input with a left lock icon and a show/hide toggle. Extracted
 * from what used to be hand-rolled once on the login page, so signup and
 * reset-password get the same treatment for free. */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35 pointer-events-none">
        <IconLock size={16} />
      </span>
      <input
        {...props}
        type={show ? "text" : "password"}
        className={`w-full pl-9 pr-10 py-2 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors ${props.className || ""}`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/70 transition-colors"
        aria-label={show ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}
