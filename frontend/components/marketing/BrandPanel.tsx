import { IconShieldCheck, IconPieChart, IconUsers, IconShuffle } from "@/components/ui/icons";

const FEATURES = [
  {
    Icon: IconShieldCheck,
    title: "Peace of mind, built in",
    body: "Full audit trail, real double-entry books, your data walled off per company.",
  },
  {
    Icon: IconPieChart,
    title: "Owner, building & room-wise P&L",
    body: "See profit down to a single room, not just the portfolio total.",
  },
  {
    Icon: IconUsers,
    title: "Role-based access",
    body: "Owners, managers, accountants and staff each see only what they should.",
  },
  {
    Icon: IconShuffle,
    title: "Expense allocation",
    body: "Split shared costs and staff salaries across buildings automatically.",
  },
];

/**
 * The left-hand marketing panel on auth pages (login/signup/reset). Hidden
 * below the `lg` breakpoint -- on mobile each page shows a compact header
 * instead (product name + tagline only), since this panel's four feature
 * blocks would just push the actual form below the fold on a phone.
 */
export function BrandPanel() {
  return (
    <div
      className="hidden lg:flex lg:flex-col lg:justify-between lg:w-[42%] shrink-0 bg-ledger text-paper px-10 py-10 relative overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(180deg, rgba(243,241,230,0.05) 0px, rgba(243,241,230,0.05) 1px, transparent 1px, transparent 48px)",
      }}
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-0.5 bg-brass" />
          <span className="text-[11px] tracking-[0.12em] text-brass font-medium">ONEACCOUNTS</span>
        </div>
        <p className="font-display text-2xl font-semibold leading-tight mt-1.5 mb-1 text-paper-card">
          Properties
          <br />
          Management
        </p>
        <p className="text-sm text-brass-light font-medium mb-8">
          Simple by design. Professional by nature.
        </p>

        <div className="space-y-5">
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <Icon size={18} className="text-brass-light mt-0.5 shrink-0" />
              <div>
                <p className="text-[13.5px] font-medium text-paper-card">{title}</p>
                <p className="text-xs text-paper/55 mt-0.5 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-paper/15 pt-3">
        <p className="text-[11.5px] text-paper/45">
          Built for the Pakistani rental market — CNIC-based records, PKR
          formatting, local number validation.
        </p>
      </div>
    </div>
  );
}

/** Compact header shown in place of BrandPanel on screens below `lg`. */
export function BrandPanelMobileHeader() {
  return (
    <div className="lg:hidden text-center mb-8">
      <p className="text-[11px] tracking-[0.12em] text-brass-dark font-medium">ONEACCOUNTS</p>
      <p className="font-display text-2xl font-semibold text-ink mt-1">Properties Management</p>
      <p className="text-sm text-ink/50 mt-1">Simple by design. Professional by nature.</p>
    </div>
  );
}
