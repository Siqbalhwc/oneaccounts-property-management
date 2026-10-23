"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ExpiringLease } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RenewLeaseModal } from "@/components/ui/RenewLeaseModal";

function pkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

function whenLabel(days: number) {
  if (days < 0) return `Ended ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Ends today";
  return `Ends in ${days} day${days === 1 ? "" : "s"}`;
}

/** Leases ending by the end of next month (plus any already past their end date). */
export function ExpiringLeasesCard() {
  const [rows, setRows] = useState<ExpiringLease[] | null>(null);
  const [renewing, setRenewing] = useState<ExpiringLease | null>(null);

  const load = useCallback(() => {
    api.get<ExpiringLease[]>("/leases/expiring").then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  if (rows !== null && rows.length === 0) return null;

  return (
    <>
      <Card title="Leases expiring by next month-end">
        {rows === null ? (
          <p className="text-sm text-ink/45 py-4 text-center">Loading…</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.lease_id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {r.tenant_name ?? "Tenant"}
                    <span className="text-ink/50 font-normal">
                      {" "}— {r.building_name ? `${r.building_name}, ` : ""}Room {r.room_number}
                    </span>
                  </p>
                  <p className="text-xs text-ink/50">
                    <span className={r.days_left < 0 ? "text-stamp-red font-medium" : ""}>{whenLabel(r.days_left)}</span>
                    {" · "}
                    <span className="figures">{r.end_date}</span>
                    {" · "}
                    {pkr(r.monthly_total)}/month
                  </p>
                </div>
                <Button type="button" variant="secondary" onClick={() => setRenewing(r)}>
                  Renew
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <RenewLeaseModal lease={renewing} onClose={() => setRenewing(null)} onRenewed={load} />
    </>
  );
}
