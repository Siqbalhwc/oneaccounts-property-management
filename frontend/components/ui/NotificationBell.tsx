"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, Building, Invoice, Lease, Room, Tenant } from "@/lib/api";
import { IconBell } from "@/components/ui/LedgerIcons";

function pkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

type NotificationItem = {
  key: string;
  href: string;
  title: string;
  subtitle: string;
  tone: "red" | "amber";
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

  // Same data the dashboard already computes "invoices awaiting payment"
  // and "leases expiring in 90 days" from -- this just surfaces it in the
  // topbar too, fetched independently so the bell works on any page, not
  // only while the dashboard itself is mounted.
  useEffect(() => {
    api.get<Invoice[]>("/invoices?exclude_paid=true").then(setInvoices).catch(() => setInvoices([]));
    api.get<Lease[]>("/leases").then(setLeases).catch(() => setLeases([]));
    api.get<Tenant[]>("/tenants").then(setTenants).catch(() => setTenants([]));
    api.get<Room[]>("/rooms").then(setRooms).catch(() => setRooms([]));
    api.get<Building[]>("/buildings").then(setBuildings).catch(() => setBuildings([]));
  }, []);

  const items = useMemo<NotificationItem[]>(() => {
    if (!invoices || !leases || !tenants || !rooms || !buildings) return [];
    const tenantsById = new Map(tenants.map((t) => [t.id, t]));
    const roomsById = new Map(rooms.map((r) => [r.id, r]));
    const buildingsById = new Map(buildings.map((b) => [b.id, b]));
    const leasesById = new Map(leases.map((l) => [l.id, l]));
    const today = new Date();

    const overdue: NotificationItem[] = invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled" && new Date(i.due_date) < today)
      .map((i) => {
        const lease = leasesById.get(i.lease_id);
        const tenant = lease ? tenantsById.get(lease.tenant_id) : undefined;
        const room = lease ? roomsById.get(lease.room_id) : undefined;
        const building = room ? buildingsById.get(room.building_id) : undefined;
        const daysOverdue = Math.floor((today.getTime() - new Date(i.due_date).getTime()) / 86400000);
        return {
          key: `inv-${i.id}`,
          href: "/invoices",
          title: `Invoice overdue — ${tenant?.full_name ?? "Tenant"}${room ? `, Apartment ${room.room_number}` : ""}`,
          subtitle: `${pkr(i.total_amount)} · ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`,
          tone: "red" as const,
        };
      });

    const ninetyDaysOut = new Date(today);
    ninetyDaysOut.setDate(today.getDate() + 90);
    const expiring: NotificationItem[] = leases
      .filter((l) => l.status === "active" && new Date(l.end_date) <= ninetyDaysOut && new Date(l.end_date) >= today)
      .map((l) => {
        const tenant = tenantsById.get(l.tenant_id);
        const room = roomsById.get(l.room_id);
        const daysLeft = Math.ceil((new Date(l.end_date).getTime() - today.getTime()) / 86400000);
        return {
          key: `lease-${l.id}`,
          href: "/leases",
          title: `Lease expiring — ${tenant?.full_name ?? "Tenant"}${room ? `, Apartment ${room.room_number}` : ""}`,
          subtitle: `Renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          tone: "amber" as const,
        };
      });

    return [...overdue, ...expiring].slice(0, 8);
  }, [invoices, leases, tenants, rooms, buildings]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 rounded-card border border-border bg-paper hover:bg-border/30 flex items-center justify-center text-ink transition-colors"
        aria-label="Notifications"
      >
        <IconBell size={16} />
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-stamp-red text-white text-[9px] font-semibold flex items-center justify-center border-2 border-paper-card">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute top-11 right-0 w-80 bg-paper-card border border-border rounded-card shadow-shell p-1.5 z-50">
            <p className="px-2.5 py-2 text-[11px] uppercase tracking-wider text-ink/50 font-medium border-b border-border mb-1">
              Needs attention
            </p>
            {items.length === 0 ? (
              <p className="px-2.5 py-4 text-sm text-ink/45 text-center">
                {invoices === null ? "Loading…" : "Nothing needs attention right now."}
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto scrollbar-thin">
                {items.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 px-2.5 py-2 rounded-card hover:bg-paper transition-colors"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        item.tone === "red" ? "bg-stamp-red" : "bg-stamp-amber"
                      }`}
                    />
                    <span>
                      <span className="block text-[12.5px] font-medium leading-snug">{item.title}</span>
                      <span className="block text-[11px] text-ink/50 mt-0.5">{item.subtitle}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
