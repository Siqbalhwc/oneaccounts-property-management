"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ExpiringLease } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

function pkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function oneYearAfter(iso: string) {
  const d = new Date(iso + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Renews a lease by extending the SAME lease record (POST /leases/{id}/renew):
 * the security deposit, invoice history and room all carry on, so nothing is
 * collected or refunded. Rates are pre-filled with the current ones and can be
 * changed. One-time charges (e.g. commission) are never carried over.
 * To close the lease instead, the user goes to the settlement screen.
 */
export function RenewLeaseModal({
  lease,
  onClose,
  onRenewed,
}: {
  lease: ExpiringLease | null;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const [newEnd, setNewEnd] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!lease) return;
    setNewEnd(oneYearAfter(lease.end_date));
    setRates(Object.fromEntries(lease.charges.map((c) => [c.id, String(c.amount)])));
    setError(null);
    setDone(null);
  }, [lease]);

  if (!lease) return null;

  const newTotal = lease.charges.reduce((s, c) => s + (Number(rates[c.id]) || 0), 0);
  const changes = lease.charges
    .filter((c) => Number(rates[c.id]) !== Number(c.amount))
    .map((c) => ({ charge_id: c.id, new_amount: Number(rates[c.id]) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!lease) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>(`/leases/${lease.lease_id}/renew`, {
        new_end_date: newEnd,
        rate_changes: changes,
      });
      setDone(res.message);
      onRenewed();
    } catch (err: any) {
      setError(err.message ?? "Could not renew the lease.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!lease} onClose={onClose} title="Renew lease">
      {done ? (
        <div className="space-y-4">
          <p className="text-sm bg-accent/5 border border-accent/15 rounded-card px-3 py-2">{done}</p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm">
            <span className="font-medium">{lease.tenant_name ?? "Tenant"}</span>
            <span className="text-ink/55">
              {" "}— {lease.building_name ? `${lease.building_name}, ` : ""}Room {lease.room_number ?? ""}
            </span>
          </p>
          <p className="text-xs text-ink/50">
            Current term ends <span className="figures">{lease.end_date}</span>. The renewal runs from{" "}
            <span className="figures">{addDays(lease.end_date, 1)}</span>.
          </p>

          <Field label="New end date">
            <Input type="date" required value={newEnd} min={addDays(lease.end_date, 1)} onChange={(e) => setNewEnd(e.target.value)} />
          </Field>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-ink/45">Monthly rates (edit to apply a new rate)</p>
            {lease.charges.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-sm flex-1">{c.label}</span>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  required
                  className="w-32 text-right"
                  value={rates[c.id] ?? ""}
                  onChange={(e) => setRates({ ...rates, [c.id]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-ink/55">Monthly total</span>
              <span className="figures font-medium">
                {pkr(newTotal)}
                {newTotal !== lease.monthly_total && (
                  <span className="text-ink/40 font-normal"> (was {pkr(lease.monthly_total)})</span>
                )}
              </span>
            </div>
          </div>

          <p className="text-xs text-ink/45">
            The security deposit carries over — nothing new is collected. One-time charges such as commission are not added again.
          </p>
          {error && <p className="text-sm text-stamp-red">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Link href={`/leases/${lease.lease_id}/settlement`} className="text-xs text-ink/50 underline hover:text-ink">
              Not renewing? Close &amp; settle instead
            </Link>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Renewing…" : "Renew lease"}</Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
