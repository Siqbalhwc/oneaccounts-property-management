"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { api, Building, Company } from "@/lib/api";
import {
  RoommateReport,
  FacilityRegister,
  FacilityKind,
  formatSpecValue,
} from "@/lib/residents";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PrintHeader } from "@/components/ui/PrintHeader";
import { Input, Select } from "@/components/ui/Field";

type Tab = "roommates" | "facilities";

const KIND_LABELS: Record<FacilityKind, string> = {
  parking: "Parking",
  internet: "Internet",
  electricity: "Electricity",
  water: "Water",
  gas: "Gas",
  other: "Other",
};

export default function ResidentsPage() {
  const [tab, setTab] = useState<Tab>("roommates");
  const [company, setCompany] = useState<Company | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);

  const [buildingId, setBuildingId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // roommates
  const [includePast, setIncludePast] = useState(false);
  const [onlyWithRoommates, setOnlyWithRoommates] = useState(false);
  const [roommateReport, setRoommateReport] = useState<RoommateReport | null>(null);

  // facilities
  const [kind, setKind] = useState("");
  const [includeEnded, setIncludeEnded] = useState(false);
  const [facilityReport, setFacilityReport] = useState<FacilityRegister | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Company>("/company/me").then(setCompany).catch(() => {});
    api.get<Building[]>("/buildings").then(setBuildings).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setError(null);
    const p = new URLSearchParams();
    if (buildingId) p.set("building_id", buildingId);
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (tab === "roommates") {
      if (includePast) p.set("include_past", "true");
      if (onlyWithRoommates) p.set("only_with_roommates", "true");
      setRoommateReport(null);
      api.get<RoommateReport>(`/room-occupants/report?${p.toString()}`).then(setRoommateReport).catch((e) => setError(e.message));
    } else {
      if (kind) p.set("kind", kind);
      if (includeEnded) p.set("include_ended", "true");
      setFacilityReport(null);
      api.get<FacilityRegister>(`/facilities/register?${p.toString()}`).then(setFacilityReport).catch((e) => setError(e.message));
    }
  }, [tab, buildingId, debouncedSearch, includePast, onlyWithRoommates, kind, includeEnded]);

  const buildingLabel = buildings.find((b) => b.id === buildingId)?.name;
  const reportTitle = `${tab === "roommates" ? "Roommates register" : "Facilities register"}${buildingLabel ? ` — ${buildingLabel}` : ""}`;

  return (
    <div className="space-y-6">
      <PrintHeader company={company} reportTitle={reportTitle} />

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Residents &amp; facilities</h1>
          <p className="text-sm text-ink/55 mt-1">
            Who lives in each apartment, and the vehicle, internet, meter and other facility details tenants have opted
            for. Add or change entries from a lease&apos;s{" "}
            <Link href="/leases" className="text-accent hover:underline">Residents</Link> page.
          </p>
        </div>
        <Button variant="secondary" onClick={() => window.print()} className="no-print">
          <Printer size={14} className="inline mr-1.5 -mt-0.5" />
          Print
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border no-print">
        {([
          ["roommates", "Roommates"],
          ["facilities", "Facilities"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? "border-brass-dark text-ink" : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-3 no-print">
        <div className="w-full lg:w-72">
          <Input
            placeholder={tab === "roommates" ? "Search tenant, roommate, CNIC, room…" : "Search tenant, vehicle, card, meter…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full lg:w-52">
          <Select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">All buildings</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </div>
        {tab === "facilities" && (
          <div className="w-full lg:w-44">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All facility types</option>
              {(Object.keys(KIND_LABELS) as FacilityKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink/60">
          {tab === "roommates" ? (
            <>
              <label className="flex items-center gap-2 whitespace-nowrap">
                <input type="checkbox" checked={onlyWithRoommates} onChange={(e) => setOnlyWithRoommates(e.target.checked)} />
                Only tenants with roommates
              </label>
              <label className="flex items-center gap-2 whitespace-nowrap">
                <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
                Include former roommates
              </label>
            </>
          ) : (
            <label className="flex items-center gap-2 whitespace-nowrap">
              <input type="checkbox" checked={includeEnded} onChange={(e) => setIncludeEnded(e.target.checked)} />
              Include ended
            </label>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t load this report — {error}</p>
        </Card>
      )}

      {tab === "roommates" && (
        <Card>
          {roommateReport === null && !error ? (
            <p className="text-sm text-ink/40">Loading…</p>
          ) : roommateReport && roommateReport.rows.length === 0 ? (
            <p className="text-sm text-ink/45">Nothing matches these filters.</p>
          ) : (
            roommateReport && (
              <>
                <p className="text-xs text-ink/50 mb-3">
                  {roommateReport.total_tenants} tenant{roommateReport.total_tenants === 1 ? "" : "s"} ·{" "}
                  {roommateReport.total_current_roommates} current roommate
                  {roommateReport.total_current_roommates === 1 ? "" : "s"}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-ink/45 border-b border-border">
                        <th className="py-2 pr-3 font-semibold">Building / room</th>
                        <th className="py-2 pr-3 font-semibold">Tenant</th>
                        <th className="py-2 pr-3 font-semibold">Roommate</th>
                        <th className="py-2 pr-3 font-semibold">Relationship</th>
                        <th className="py-2 pr-3 font-semibold">CNIC</th>
                        <th className="py-2 pr-3 font-semibold">Phone</th>
                        <th className="py-2 font-semibold">Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roommateReport.rows.map((row) =>
                        row.roommates.length === 0 ? (
                          <tr key={row.lease_id} className="border-b border-border/60">
                            <td className="py-2.5 pr-3">{row.building_name} — {row.room_number}</td>
                            <td className="py-2.5 pr-3">
                              <span className="font-medium">{row.tenant_name}</span>
                              <span className="block text-xs figures text-ink/50">{row.tenant_cnic}</span>
                            </td>
                            <td colSpan={5} className="py-2.5 text-ink/40">No roommates declared</td>
                          </tr>
                        ) : (
                          row.roommates.map((m, i) => (
                            <tr key={m.id} className={`align-top ${i === row.roommates.length - 1 ? "border-b border-border/60" : ""}`}>
                              <td className="py-2.5 pr-3">{i === 0 ? `${row.building_name} — ${row.room_number}` : ""}</td>
                              <td className="py-2.5 pr-3">
                                {i === 0 && (
                                  <>
                                    <span className="font-medium">{row.tenant_name}</span>
                                    <span className="block text-xs figures text-ink/50">{row.tenant_cnic}</span>
                                  </>
                                )}
                              </td>
                              <td className={`py-2.5 pr-3 font-medium ${m.moved_out_date ? "text-ink/45" : ""}`}>{m.full_name}</td>
                              <td className="py-2.5 pr-3 text-ink/70">{m.relationship ?? "—"}</td>
                              <td className="py-2.5 pr-3 figures text-ink/70">{m.cnic ?? "—"}</td>
                              <td className="py-2.5 pr-3 figures text-ink/70">{m.phone ?? "—"}</td>
                              <td className="py-2.5 figures text-ink/70">
                                {m.moved_in_date}
                                {m.moved_out_date ? ` → ${m.moved_out_date}` : " → present"}
                              </td>
                            </tr>
                          ))
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </Card>
      )}

      {tab === "facilities" && (
        <Card>
          {facilityReport === null && !error ? (
            <p className="text-sm text-ink/40">Loading…</p>
          ) : facilityReport && facilityReport.rows.length === 0 ? (
            <p className="text-sm text-ink/45">Nothing matches these filters.</p>
          ) : (
            facilityReport && (
              <>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink/50 mb-3">
                  <span className="font-medium text-ink/70">{facilityReport.total} entries</span>
                  {(Object.keys(KIND_LABELS) as FacilityKind[])
                    .filter((k) => facilityReport.counts_by_kind[k] > 0)
                    .map((k) => (
                      <span key={k}>{KIND_LABELS[k]}: {facilityReport.counts_by_kind[k]}</span>
                    ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-ink/45 border-b border-border">
                        <th className="py-2 pr-3 font-semibold">Building / room</th>
                        <th className="py-2 pr-3 font-semibold">Tenant</th>
                        <th className="py-2 pr-3 font-semibold">Facility</th>
                        <th className="py-2 pr-3 font-semibold">Details</th>
                        <th className="py-2 font-semibold">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facilityReport.rows.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 align-top">
                          <td className="py-2.5 pr-3">{r.building_name} — {r.room_number}</td>
                          <td className="py-2.5 pr-3">
                            <span className="font-medium">{r.tenant_name}</span>
                            {r.tenant_phone && <span className="block text-xs figures text-ink/50">{r.tenant_phone}</span>}
                          </td>
                          <td className="py-2.5 pr-3">
                            {r.label}
                            {!r.is_active && <span className="block text-xs text-ink/45">ended {r.ended_on}</span>}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="space-y-0.5">
                              {r.specs_display.map((d, i) => (
                                <p key={i}>
                                  <span className="text-ink/50">{d.label}: </span>
                                  <span className="figures font-medium">{formatSpecValue(d)}</span>
                                </p>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 text-ink/65">{r.notes ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </Card>
      )}
    </div>
  );
}
