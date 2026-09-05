"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Company } from "@/lib/api";
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher";
import {
  IconDashboard,
  IconProperty,
  IconOwners,
  IconTenants,
  IconLeases,
  IconMoney,
  IconInvoices,
  IconExpenses,
  IconStaff,
  IconAccounting,
  IconJournal,
  IconScale,
  IconTrend,
  IconBalanceSheet,
  IconReports,
  IconSettings,
  IconTower,
  IconImplementation,
  IconChevron,
} from "@/components/ui/LedgerIcons";

type NavItem = { href: string; label: string; icon: (p: { size?: number; className?: string }) => JSX.Element };
type NavSection = {
  key: string;
  label: string;
  icon: (p: { size?: number; className?: string }) => JSX.Element;
  items: NavItem[];
};

// "Dashboard" is intentionally not in here -- it's a single item pinned
// above the accordion, not a section of its own (nothing to collapse).
const BASE_SECTIONS: NavSection[] = [
  {
    key: "property",
    label: "Property",
    icon: IconProperty,
    items: [
      { href: "/buildings", label: "Buildings & apartments", icon: IconProperty },
      { href: "/owners", label: "Owners", icon: IconOwners },
      { href: "/tenants", label: "Tenants", icon: IconTenants },
      { href: "/leases", label: "Leases", icon: IconLeases },
    ],
  },
  {
    key: "money",
    label: "Money",
    icon: IconMoney,
    items: [
      { href: "/invoices", label: "Invoices", icon: IconInvoices },
      { href: "/expenses", label: "Expenses", icon: IconExpenses },
      { href: "/staff", label: "Staff & salaries", icon: IconStaff },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    icon: IconAccounting,
    items: [
      { href: "/chart-of-accounts", label: "Chart of accounts", icon: IconAccounting },
      { href: "/journal", label: "Journal entries", icon: IconJournal },
      { href: "/trial-balance", label: "Trial balance", icon: IconScale },
      { href: "/profit-and-loss", label: "Profit & loss", icon: IconTrend },
      { href: "/balance-sheet", label: "Balance sheet", icon: IconBalanceSheet },
      { href: "/reports", label: "Reports", icon: IconReports },
    ],
  },
  {
    key: "company",
    label: "Company",
    icon: IconSettings,
    items: [{ href: "/settings", label: "Settings", icon: IconSettings }],
  },
];

export function Sidebar({
  company,
  mobileOpen,
  onClose,
  isPlatformAdmin,
  showImplementation,
}: {
  company: Company | null;
  mobileOpen: boolean;
  onClose: () => void;
  isPlatformAdmin?: boolean;
  showImplementation?: boolean;
}) {
  const pathname = usePathname();

  // Platform/Onboarding are conditional, so they're appended dynamically
  // rather than living in the static list above.
  const sections = useMemo<NavSection[]>(() => {
    const extra: NavSection[] = [];
    if (isPlatformAdmin) {
      extra.push({
        key: "platform",
        label: "Platform",
        icon: IconTower,
        items: [
          { href: "/tower", label: "Tower — all companies", icon: IconTower },
          { href: "/implementation", label: "Implementation Portal", icon: IconImplementation },
        ],
      });
    } else if (showImplementation) {
      extra.push({
        key: "onboarding",
        label: "Onboarding",
        icon: IconImplementation,
        items: [{ href: "/implementation", label: "My Implementation", icon: IconImplementation }],
      });
    }
    return [...BASE_SECTIONS, ...extra];
  }, [isPlatformAdmin, showImplementation]);

  const [openSection, setOpenSection] = useState<string | null>(null);

  // Whichever section holds the current page auto-expands -- on first load
  // and again on every navigation -- so you're never looking at a
  // collapsed sidebar while sitting on a page inside it. If the person has
  // manually opened a different section, navigating away from it still
  // re-syncs to wherever they actually are.
  useEffect(() => {
    const active = sections.find((sec) =>
      sec.items.some((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)))
    );
    setOpenSection(active?.key ?? null);
  }, [pathname, sections]);

  function toggleSection(key: string) {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  const dashboardActive = pathname === "/";

  return (
    <>
      {/* Mobile scrim, only shown while the drawer is open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-ink/40 z-40 lg:hidden no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`no-print w-60 shrink-0 bg-ledger text-sidebar-ink flex flex-col fixed lg:sticky top-0 lg:top-4 left-0 h-screen lg:h-[calc(100vh-2rem)] lg:rounded-shell lg:shadow-shell overflow-hidden z-50 transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-5 py-6 border-b border-sidebar-ink/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {company?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo_url}
                alt={company.name}
                className="w-9 h-9 rounded-card object-contain bg-sidebar-ink/10 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-card bg-brass/15 border border-brass/35 text-brass flex items-center justify-center shrink-0">
                <IconProperty size={17} />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-display text-base font-semibold tracking-tight truncate">
                {company?.name || "Ledger"}
              </p>
              <p className="text-xs text-sidebar-ink/50 mt-0.5">Property Management</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-sidebar-ink/60 hover:text-sidebar-ink shrink-0">
            <X size={20} />
          </button>
        </div>

        <nav className="px-3 py-4 overflow-y-auto scrollbar-thin shrink-0">
          {/* Dashboard: pinned, single item, no accordion needed */}
          <Link
            href="/"
            onClick={onClose}
            className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-card text-sm font-medium mb-3 transition-colors ${
              dashboardActive ? "bg-brass/15 text-sidebar-ink" : "text-sidebar-ink hover:bg-sidebar-ink/5"
            }`}
          >
            <IconDashboard size={16} className="opacity-90 shrink-0" />
            Dashboard
            {dashboardActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brass" />}
          </Link>

          {sections.map((section) => {
            const isOpen = openSection === section.key;
            const SectionIcon = section.icon;
            return (
              <div key={section.key} className="mb-1">
                <button
                  onClick={() => toggleSection(section.key)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-card text-[13px] font-medium transition-colors ${
                    isOpen ? "text-sidebar-ink" : "text-sidebar-ink/80 hover:text-sidebar-ink hover:bg-sidebar-ink/5"
                  }`}
                  aria-expanded={isOpen}
                >
                  <SectionIcon size={15} className="opacity-85 shrink-0" />
                  <span className="truncate">{section.label}</span>
                  <IconChevron
                    size={12}
                    className={`ml-auto opacity-55 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${
                    isOpen ? "max-h-96" : "max-h-0"
                  }`}
                >
                  <div className="pt-0.5 pb-1 space-y-0.5">
                    {section.items.map((item) => {
                      const ItemIcon = item.icon;
                      const active =
                        item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          className={`flex items-center gap-2.5 pl-8 pr-2.5 py-2 rounded-card text-[13px] relative transition-colors ${
                            active
                              ? "bg-brass/[0.16] text-sidebar-ink font-medium"
                              : "text-sidebar-ink/65 hover:text-sidebar-ink hover:bg-sidebar-ink/5"
                          }`}
                        >
                          <ItemIcon size={13} className="opacity-80 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {active && (
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-brass" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* Absorbs whatever height the nav list doesn't use, so the panel
            still reads as one full-height piece rather than leaving a dead
            gap above the footer on a short nav list. */}
        <div className="flex-1 flex items-center justify-center opacity-[0.05] pointer-events-none min-h-10">
          <IconProperty size={72} />
        </div>

        <div className="px-5 py-3 border-t border-sidebar-ink/10 shrink-0 flex items-center justify-between gap-2">
          <span className="text-[9.5px] font-semibold tracking-wide text-sidebar-ink/40">THEME</span>
          <ThemeSwitcher />
        </div>

        <div className="px-5 py-3 border-t border-sidebar-ink/10 shrink-0">
          <p className="text-[11px] text-sidebar-ink/40 truncate">{company?.name || ""}</p>
        </div>
      </aside>
    </>
  );
}
