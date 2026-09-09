import Image from "next/image";
import { IconWallet, IconTrendingUp } from "@/components/ui/icons";
import logo from "../../app/logo-transparent-master.png";

// Illustrative numbers only -- this renders before anyone is signed in, so
// there's no real company/session to pull live figures from yet. Matches
// the shape of a real August dashboard (see the actual /dashboard page)
// rather than inventing a different chart style just for this panel.
const OCCUPANCY = { occupied: 33, vacant: 3, maintenance: 2 };
const OCCUPANCY_PCT = {
  occupied: 87,
  vacant: 8,
  maintenance: 5,
};
// height %, income bar + optional paired expense bar, oldest to newest
const MONTHLY_BARS: { income: number; expense?: number }[] = [
  { income: 42 },
  { income: 14 },
  { income: 5 },
  { income: 80, expense: 32 },
  { income: 100, expense: 52 },
  { income: 62 },
];

/**
 * The left-hand marketing panel on auth pages. Hidden below the `lg`
 * breakpoint -- BrandPanelMobileHeader below shows a compact header
 * instead, since this panel would push the actual form below the fold on
 * a phone.
 *
 * No longer owns its own width/background -- AuthShell handles the shared
 * layout and ambient background now, so this is just content.
 */
export function BrandPanel() {
  return (
    <div className="hidden lg:block lg:flex-1 lg:max-w-[560px]">
      <div className="flex items-center gap-3 mb-7">
        <Image src={logo} alt="OneAccounts" width={40} height={40} priority />
        <span className="font-body font-bold text-[19px] tracking-[0.01em] text-ink">
          ONEACCOUNTS
        </span>
      </div>

      <h1 className="font-display text-[2.5rem] leading-[1.08] font-semibold text-ink mb-3">
        Properties Management
      </h1>
      <p className="text-base font-medium text-brass-light mb-4">
        Simple by design. Professional by nature.
      </p>
      <p className="text-sm leading-relaxed text-ink/60 max-w-[40ch] mb-9">
        Peace of mind, built in — full audit trail, real double-entry books,
        and role-based access, all live below across your whole portfolio.
      </p>

      <DashboardHeroCard />

      <p className="text-xs leading-relaxed text-ink/40 max-w-[42ch] mt-7">
        Built for the Pakistani rental market — CNIC records, PKR formatting,
        and WhatsApp invoicing.
      </p>
    </div>
  );
}

function DashboardHeroCard() {
  const donutStyle: React.CSSProperties = {
    background: `conic-gradient(
      rgb(var(--stamp-green)) 0% ${OCCUPANCY_PCT.occupied}%,
      rgb(var(--brass)) ${OCCUPANCY_PCT.occupied}% ${OCCUPANCY_PCT.occupied + OCCUPANCY_PCT.vacant}%,
      rgb(var(--rule)) ${OCCUPANCY_PCT.occupied + OCCUPANCY_PCT.vacant}% 100%
    )`,
  };

  return (
    <div className="relative max-w-[480px] card px-6 py-5">
      <span className="stamp stamp-active absolute -top-3.5 -right-3.5 bg-paper-card">
        ✓ Balanced
      </span>

      <p className="font-mono text-[10.5px] tracking-[0.12em] text-brass-light mb-4">
        DASHBOARD — AUGUST 2026
      </p>

      <div className="flex gap-7 mb-5">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-[22px] h-[22px] rounded-md flex items-center justify-center bg-stamp-green/15 text-stamp-green shrink-0">
              <IconWallet size={12} />
            </span>
            <span className="font-mono text-[9.5px] tracking-[0.09em] text-ink/40">
              COLLECTED THIS MONTH
            </span>
          </div>
          <p className="figures text-[19px] text-ink">Rs 586,753</p>
          <p className="text-[11px] text-stamp-green">+24.3% from last month</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-[22px] h-[22px] rounded-md flex items-center justify-center bg-brass/15 text-brass-light shrink-0">
              <IconTrendingUp size={12} />
            </span>
            <span className="font-mono text-[9.5px] tracking-[0.09em] text-ink/40">
              NET PROFIT
            </span>
          </div>
          <p className="figures text-[19px] text-ink">Rs 66,253</p>
          <p className="text-[11px] text-ink/40">Across 14 buildings</p>
        </div>
      </div>

      <div className="flex items-center gap-5 pt-4 border-t border-border">
        <div className="relative w-[76px] h-[76px] rounded-full shrink-0" style={donutStyle}>
          <div className="absolute inset-[13px] rounded-full bg-paper-card" />
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[13px] font-medium text-ink">
            {OCCUPANCY_PCT.occupied}%
          </div>
        </div>

        <div className="text-[11px] space-y-1">
          <LegendRow colorClass="bg-stamp-green" label={`Occupied — ${OCCUPANCY.occupied}`} />
          <LegendRow colorClass="bg-brass" label={`Vacant — ${OCCUPANCY.vacant}`} />
          <LegendRow colorClass="bg-rule" label={`Maintenance — ${OCCUPANCY.maintenance}`} />
        </div>

        <div
          className="flex-1 flex items-end gap-1.5 h-16 pl-3.5 border-l border-border"
          aria-label="Income vs expenses, last 6 months"
        >
          {MONTHLY_BARS.map((m, i) => (
            <div key={i} className="flex items-end gap-0.5 flex-1 h-full">
              <div className="flex-1 rounded-t-sm bg-brass/55" style={{ height: `${m.income}%` }} />
              {m.expense !== undefined && (
                <div
                  className="max-w-[5px] flex-1 rounded-t-sm bg-rule/60"
                  style={{ height: `${m.expense}%` }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendRow({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-ink/70">
      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${colorClass}`} />
      {label}
    </div>
  );
}

/** Compact header shown in place of BrandPanel on screens below `lg`. */
export function BrandPanelMobileHeader() {
  return (
    <div className="lg:hidden flex flex-col items-center text-center mb-8">
      <Image src={logo} alt="OneAccounts" width={40} height={40} priority className="mb-2" />
      <span className="font-body font-bold text-[15px] tracking-[0.01em] text-ink">
        ONEACCOUNTS
      </span>
      <p className="font-display text-2xl font-semibold text-ink mt-2">Properties Management</p>
      <p className="text-sm text-ink/50 mt-1">Simple by design. Professional by nature.</p>
    </div>
  );
}
