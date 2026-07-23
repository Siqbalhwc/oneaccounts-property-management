"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Lease } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";

export default function LeasesPage() {
  const [leases, setLeases] = useState<Lease[] | null>(null);

  useEffect(() => {
    api.get<Lease[]>("/leases").then(setLeases);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
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
            { header: "Start date", accessor: (l) => l.start_date },
            { header: "End date", accessor: (l) => l.end_date },
            { header: "Status", accessor: (l) => <StampBadge status={l.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}
