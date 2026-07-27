"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Lease, Tenant, Room, Building } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";

export default function LeasesPage() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

  useEffect(() => {
    api.get<Lease[]>("/leases").then(setLeases);
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Building[]>("/buildings").then(setBuildings);
  }, []);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? "—";
  const roomAndBuilding = (roomId: string) => {
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Leases</h1>
          <p className="text-sm text-ink/55 mt-1">
            One-year agreements linking a tenant to a room, with their rent
            structure and security deposit.
          </p>
        </div>
        <Link href="/leases/new">
          <Button>New lease</Button>
        </Link>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={leases ?? []}
          emptyMessage="No leases yet — create one to get started."
          columns={[
            { header: "Tenant", accessor: (l) => <span className="font-medium">{tenantName(l.tenant_id)}</span> },
            { header: "Building / Room", accessor: (l) => roomAndBuilding(l.room_id) },
            { header: "Start date", accessor: (l) => l.start_date },
            { header: "End date", accessor: (l) => l.end_date },
            { header: "Status", accessor: (l) => <StampBadge status={l.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}
