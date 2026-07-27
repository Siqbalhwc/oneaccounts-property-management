"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { api } from "@/lib/api";

type CompanyOverview = {
  id: string;
  name: string;
  created_at: string;
  building_count: number;
  tenant_count: number;
  room_count: number;
  occupied_room_count: number;
  user_count: number;
  income_this_month: number;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function TowerPage() {
  const [companies, setCompanies] = useState<CompanyOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CompanyOverview[]>("/platform/companies")
      .then(setCompanies)
      .catch((e) => setError(e.message));
  }, []);

  const totals = (companies ?? []).reduce(
    (acc, c) => ({
      companies: acc.companies + 1,
      buildings: acc.buildings + c.building_count,
      tenants: acc.tenants + c.tenant_count,
      income: acc.income + Number(c.income_this_month || 0),
    }),
    { companies: 0, buildings: 0, tenants: 0, income: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Tower</h1>
        <p className="text-sm text-ink/55 mt-1">
          A view across every company on the platform — visible only to you.
        </p>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">
            Couldn&apos;t load this — {error}. This page requires platform admin access.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Companies</p>
          <p className="text-2xl font-display font-semibold figures">{totals.companies}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Buildings</p>
          <p className="text-2xl font-display font-semibold figures">{totals.buildings}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Tenants</p>
          <p className="text-2xl font-display font-semibold figures">{totals.tenants}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">
            Income this month (all companies)
          </p>
          <p className="text-2xl font-display font-semibold figures">{formatPkr(totals.income)}</p>
        </div>
      </div>

      <Card title="Every company">
        <DataTable
          keyField="id"
          rows={companies ?? []}
          emptyMessage="No companies yet."
          columns={[
            { header: "Company", accessor: (c) => <span className="font-medium">{c.name}</span> },
            { header: "Users", accessor: (c) => c.user_count, align: "right" },
            { header: "Buildings", accessor: (c) => c.building_count, align: "right" },
            { header: "Tenants", accessor: (c) => c.tenant_count, align: "right" },
            {
              header: "Occupancy",
              accessor: (c) =>
                c.room_count > 0 ? `${Math.round((c.occupied_room_count / c.room_count) * 100)}%` : "—",
              align: "right",
            },
            {
              header: "Income this month",
              accessor: (c) => <span className="figures">{formatPkr(c.income_this_month)}</span>,
              align: "right",
            },
            { header: "Joined", accessor: (c) => c.created_at?.slice(0, 10) },
          ]}
        />
      </Card>
    </div>
  );
}
