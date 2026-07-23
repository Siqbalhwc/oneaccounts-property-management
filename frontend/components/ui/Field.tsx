import { InputHTMLAttributes, SelectHTMLAttributes, LabelHTMLAttributes } from "react";

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
