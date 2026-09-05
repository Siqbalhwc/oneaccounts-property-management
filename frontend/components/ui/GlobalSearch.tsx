"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, Building, Tenant } from "@/lib/api";
import { IconSearch, IconTenants, IconProperty } from "@/components/ui/LedgerIcons";

type Result = { key: string; href: string; title: string; subtitle: string; icon: JSX.Element };

/**
 * MVP client-side search: tenants and buildings are already small,
 * frequently-loaded lists, so they're fetched once (lazily, on first
 * focus) and filtered in the browser rather than round-tripping to a
 * dedicated search endpoint. Worth promoting to a real /search endpoint
 * once rooms/leases/invoices need to be included too.
 */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  function ensureLoaded() {
    if (loaded) return;
    setLoaded(true);
    api.get<Tenant[]>("/tenants").then(setTenants).catch(() => {});
    api.get<Building[]>("/buildings").then(setBuildings).catch(() => {});
  }

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const tenantResults: Result[] = tenants
      .filter(
        (t) =>
          t.full_name.toLowerCase().includes(q) ||
          t.cnic?.toLowerCase().includes(q) ||
          t.phone?.toLowerCase().includes(q)
      )
      .slice(0, 5)
      .map((t) => ({
        key: `tenant-${t.id}`,
        href: "/tenants",
        title: t.full_name,
        subtitle: t.cnic,
        icon: <IconTenants size={14} />,
      }));

    const buildingResults: Result[] = buildings
      .filter((b) => b.name.toLowerCase().includes(q) || b.address?.toLowerCase().includes(q))
      .slice(0, 5)
      .map((b) => ({
        key: `building-${b.id}`,
        href: "/buildings",
        title: b.name,
        subtitle: b.address || "Building",
        icon: <IconProperty size={14} />,
      }));

    return [...tenantResults, ...buildingResults].slice(0, 8);
  }, [query, tenants, buildings]);

  const showDropdown = focused && query.trim().length >= 2;

  return (
    <div className="relative flex-1 max-w-[420px]">
      <div className="flex items-center gap-2 bg-paper border border-border rounded-card px-3 py-2 focus-within:border-brass-dark focus-within:ring-2 focus-within:ring-brass/20 transition-shadow">
        <IconSearch size={14} className="text-ink/40 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setFocused(true);
            ensureLoaded();
          }}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder="Search tenants, buildings…"
          className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-ink/35 min-w-0"
        />
      </div>

      {showDropdown && (
        <div className="absolute top-11 left-0 right-0 bg-paper-card border border-border rounded-card shadow-shell p-1.5 z-50 max-h-80 overflow-y-auto scrollbar-thin">
          {results.length === 0 ? (
            <p className="px-2.5 py-4 text-sm text-ink/45 text-center">No matches.</p>
          ) : (
            results.map((r) => (
              <Link
                key={r.key}
                href={r.href}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-card hover:bg-paper transition-colors"
              >
                <span className="w-7 h-7 rounded-full bg-accent/8 text-accent flex items-center justify-center shrink-0">
                  {r.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium truncate">{r.title}</span>
                  <span className="block text-[11px] text-ink/50 truncate">{r.subtitle}</span>
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
