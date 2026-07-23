"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard" }],
  },
  {
    label: "Property",
    items: [
      { href: "/buildings", label: "Buildings & rooms" },
      { href: "/tenants", label: "Tenants" },
      { href: "/leases", label: "Leases" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/invoices", label: "Invoices" },
      { href: "/expenses", label: "Expenses" },
      { href: "/owner-ledger", label: "Owner ledger" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Company",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 bg-ledger text-paper min-h-screen flex flex-col">
      <div className="px-5 py-6 border-b border-paper/10">
        <p className="font-display text-lg font-semibold tracking-tight">Ledger</p>
        <p className="text-xs text-paper/50 mt-0.5">Property Management</p>
      </div>

      <nav className="flex-1 px-3 py-5 space-y-6">
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
      </nav>

      <div className="px-5 py-4 border-t border-paper/10">
        <p className="text-[11px] text-paper/40">Sunrise Estates Pvt. Ltd.</p>
      </div>
    </aside>
  );
}
