"use client";

import { useTheme, ThemeName } from "@/lib/theme";

const OPTIONS: { value: ThemeName; label: string; icon: JSX.Element }[] = [
  {
    value: "ledger",
    label: "Ledger",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "black",
    label: "Black",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
      </svg>
    ),
  },
  {
    value: "navy",
    label: "Navy",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
];

/**
 * Small icon-only theme switcher, meant to sit in the sidebar footer.
 * Deliberately compact -- no text labels or color swatches -- so it reads
 * as a quiet utility control rather than a feature calling attention to
 * itself. Each button carries a title attribute for a native tooltip.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={`w-[26px] h-[26px] flex items-center justify-center rounded-md border transition-colors ${
              active
                ? "border-brass bg-brass/[0.18] text-brass"
                : "border-sidebar-ink/[0.14] bg-sidebar-ink/5 text-sidebar-ink/55 hover:text-sidebar-ink/90 hover:bg-sidebar-ink/10"
            }`}
          >
            <span className="w-[13px] h-[13px]">{opt.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
