"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Company } from "@/lib/api";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard" }],
  },
  {
    label: "Property",
    items: [
      { href: "/buildings", label: "Buildings & rooms" },
      { href: "/owners", label: "Owners" },
      { href: "/tenants", label: "Tenants" },
      { href: "/leases", label: "Leases" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/invoices", label: "Invoices" },
      { href: "/expenses", label: "Expenses" },
      { href: "/staff", label: "Staff & salaries" },
      { href: "/chart-of-accounts", label: "Chart of accounts" },
      { href: "/journal", label: "Journal entries" },
      { href: "/trial-balance", label: "Trial balance" },
      { href: "/profit-and-loss", label: "Profit & loss" },
      { href: "/balance-sheet", label: "Balance sheet" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Company",
    items: [{ href: "/settings", label: "Settings" }],
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
        className={`no-print w-60 shrink-0 bg-ledger text-paper flex flex-col fixed lg:sticky top-0 h-screen z-50 transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-5 py-6 border-b border-paper/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {company?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo_url}
                alt={company.name}
                className="w-9 h-9 rounded-card object-contain bg-paper/10 shrink-0"
              />
            ) : null}
            <div className="min-w-0">
              <p className="font-display text-base font-semibold tracking-tight truncate">
                {company?.name || "Ledger"}
              </p>
              <p className="text-xs text-paper/50 mt-0.5">Property Management</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-paper/60 hover:text-paper shrink-0">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-6 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-2 text-[10px] uppercase tracking-widest text-paper/40 font-medium mb-2">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`block px-2.5 py-2 rounded-card text-sm transition-colors ${
                        active
                          ? "bg-paper/10 text-paper font-medium border-l-2 border-brass -ml-px pl-[9px]"
                          : "text-paper/70 hover:text-paper hover:bg-paper/5"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {isPlatformAdmin && (
            <div>
              <p className="px-2 text-[10px] uppercase tracking-widest text-brass/70 font-medium mb-2">
                Platform
              </p>
              <div className="space-y-0.5">
                <Link
                  href="/tower"
                  onClick={onClose}
                  className={`block px-2.5 py-2 rounded-card text-sm transition-colors ${
                    pathname.startsWith("/tower")
                      ? "bg-paper/10 text-paper font-medium border-l-2 border-brass -ml-px pl-[9px]"
                      : "text-paper/70 hover:text-paper hover:bg-paper/5"
                  }`}
                >
                  Tower — all companies
                </Link>
                <Link
                  href="/implementation"
                  onClick={onClose}
                  className={`block px-2.5 py-2 rounded-card text-sm transition-colors ${
                    pathname.startsWith("/implementation")
                      ? "bg-paper/10 text-paper font-medium border-l-2 border-brass -ml-px pl-[9px]"
                      : "text-paper/70 hover:text-paper hover:bg-paper/5"
                  }`}
                >
                  Implementation Portal
                </Link>
              </div>
            </div>
          )}

          {!isPlatformAdmin && showImplementation && (
            <div>
              <p className="px-2 text-[10px] uppercase tracking-widest text-brass/70 font-medium mb-2">
                Onboarding
              </p>
              <Link
                href="/implementation"
                onClick={onClose}
                className={`block px-2.5 py-2 rounded-card text-sm transition-colors ${
                  pathname.startsWith("/implementation")
                    ? "bg-paper/10 text-paper font-medium border-l-2 border-brass -ml-px pl-[9px]"
                    : "text-paper/70 hover:text-paper hover:bg-paper/5"
                }`}
              >
                My Implementation
              </Link>
            </div>
          )}
        </nav>

        <div className="px-5 py-4 border-t border-paper/10">
          <p className="text-[11px] text-paper/40 truncate">{company?.name || ""}</p>
        </div>
      </aside>
    </>
  );
}
