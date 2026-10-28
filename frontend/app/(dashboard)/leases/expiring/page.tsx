"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ExpiringLease } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { RenewLeaseModal } from "@/components/ui/RenewLeaseModal";
import { useLabels } from "@/lib/labels";

function pkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthEnd(offsetMonths: number) {
  const t = new Date();
  return iso(new Date(Date.UTC(t.getFullYear(), t.getMonth() + offsetMonths + 1, 0)));
}

type WindowKey = "next_month" | "this_month" | "90" | "all";

function throughFor(w: WindowKey) {
  if (w === "this_month") return monthEnd(0);
  if (w === "next_month") return monthEnd(1);
  if (w === "90") return iso(new Date(Date.now() + 90 * 86400000));
  return "9999-12-31";
}

function whenLabel(days: number) {
  if (days < 0) return `Ended ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Ends today";
  return `Ends in ${days} day${days === 1 ? "" : "s"}`;
}

export default function ExpiringLeasesPage() {
  const { L } = useLabels();
  const [windowKey, setWindowKey] = useState<WindowKey>("next_month");
  const [rows, setRows] = useState<ExpiringLease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [renewing, setRenewing] = useState<ExpiringLease | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setError(null);
    api
      .get<ExpiringLease[]>(`/leases/expiring?through=${throughFor(windowKey)}`)
      .then(setRows)
      .catch((e) => {
        setError(e.message ?? "Couldn't load expiring leases.");
        setRows([]);
      });
  }, [windowKey]);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [r.tenant_name, r.building_name, r.room_number].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const pastDue = visible.filter((r) => r.days_left < 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Expiring leases</h1>
          <p className="text-sm text-ink/55 mt-1">
            Renew with the current or new rates, or close the lease and settle the account.
          </p>
        </div>
        <Link href="/leases">
          <Button variant="secondary">All leases</Button>
        </Link>
      </div>

      <Card>
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L("Search by tenant, building, or apartment…")}
            className="max-w-xs"
          />
          <Select
            value={windowKey}
            onChange={(e) => setWindowKey(e.target.value as WindowKey)}
            className="max-w-[240px]"
          >
            <option value="this_month">Ending by this month-end</option>
            <option value="next_month">Ending by next month-end</option>
            <option value="90">Ending within 90 days</option>
            <option value="all">All active leases (any end date)</option>
          </Select>
          {rows && (
            <span className="text-xs text-ink/50">
              {visible.length} lease{visible.length === 1 ? "" : "s"}
              {pastDue > 0 && <span className="text-stamp-red font-medium"> · {pastDue} past end date</span>}
            </span>
          )}
        </div>

        {error && <p className="text-sm text-stamp-red mb-3">{error}</p>}

        {rows === null ? (
          <p className="text-sm text-ink/45 py-8 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-ink/45 py-8 text-center">No leases ending in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink/45 border-b border-border">
                  <th className="py-2 pr-4 font-medium">Tenant</th>
                  <th className="py-2 pr-4 font-medium">{L("Property / Apartment")}</th>
                  <th className="py-2 pr-4 font-medium whitespace-nowrap">End date</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Monthly rent</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.lease_id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4 font-medium">{r.tenant_name ?? "Tenant"}</td>
                    <td className="py-3 pr-4">
                      {r.building_name ? `${r.building_name} — ` : ""}Room {r.room_number}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap figures">{r.end_date}</td>
                    <td className={`py-3 pr-4 whitespace-nowrap ${r.days_left < 0 ? "text-stamp-red font-medium" : ""}`}>
                      {whenLabel(r.days_left)}
                    </td>
                    <td className="py-3 pr-4 text-right whitespace-nowrap figures">{pkr(r.monthly_total)}</td>
                    <td className="py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <Button type="button" variant="secondary" onClick={() => setRenewing(r)}>
                          Renew
                        </Button>
                        <Link href={`/leases/${r.lease_id}/settlement`}>
                          <Button type="button" variant="ghost">Close &amp; settle</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RenewLeaseModal lease={renewing} onClose={() => setRenewing(null)} onRenewed={load} />
    </div>
  );
}
