import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-ledger text-paper-card hover:bg-ledger-dark border border-ledger",
  secondary:
    "bg-transparent text-ledger border border-ledger hover:bg-ledger/5",
  ghost: "bg-transparent text-ink hover:bg-ink/5 border border-transparent",
  danger:
    "bg-transparent text-stamp-red border border-stamp-red hover:bg-stamp-red/5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", children, ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-card transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
);
Button.displayName = "Button";
