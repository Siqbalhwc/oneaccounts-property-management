"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Pencil, Plus, UserMinus, Power } from "lucide-react";
import { api, Lease, Tenant, Room, Building } from "@/lib/api";
import { useAccess } from "@/lib/access";
import {
  Roommate,
  Facility,
  FacilityTemplates,
  FacilityKind,
  classifyLabel,
  formatSpecValue,
} from "@/lib/residents";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StampBadge } from "@/components/ui/StampBadge";
import { Field, Input, Select } from "@/components/ui/Field";

type LeaseCharge = { label: string };
const emptyRoommate = { full_name: "", relationship: "", cnic: "", phone: "", address: "", moved_in_date: "" };
type ExtraRow = { key: string; value: string };

export default function LeaseResidentsPage() {
  const params = useParams();
  const leaseId = params.id as string;
  const access = useAccess();
  // While /access/me is loading (null) nothing is hidden; the server enforces
  // the real rules either way, so this only controls which buttons are shown.
  const can = (flag: "can_add_roommates" | "can_edit_roommates" | "can_remove_roommates" | "can_manage_facilities") =>
    access ? access[flag] !== false : true;

  const [lease, setLease] = useState<Lease | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [charges, setCharges] = useState<LeaseCharge[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [roommates, setRoommates] = useState<Roommate[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [templates, setTemplates] = useState<FacilityTemplates | null>(null);

  // ---- roommate modal ----
  const [rmOpen, setRmOpen] = useState(false);
  const [rmEditingId, setRmEditingId] = useState<string | null>(null);
  const [rmForm, setRmForm] = useState(emptyRoommate);
  const [rmSaving, setRmSaving] = useState(false);
  const [rmError, setRmError] = useState<string | null>(null);

  // ---- remove roommate ----
  const [removeTarget, setRemoveTarget] = useState<Roommate | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeDate, setRemoveDate] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ---- facility modal ----
  const [fOpen, setFOpen] = useState(false);
  const [fEditingId, setFEditingId] = useState<string | null>(null);
  const [fLabelChoice, setFLabelChoice] = useState("");
  const [fCustomLabel, setFCustomLabel] = useState("");
  const [fSpecs, setFSpecs] = useState<Record<string, string>>({});
  const [fExtras, setFExtras] = useState<ExtraRow[]>([]);
  const [fNotes, setFNotes] = useState("");
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);

  // ---- end facility ----
  const [endTarget, setEndTarget] = useState<Facility | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  const leaseActive = lease?.status === "active";

  const loadRoommates = useCallback(() => {
    api.get<Roommate[]>(`/room-occupants?lease_id=${leaseId}`).then(setRoommates).catch(() => setRoommates([]));
  }, [leaseId]);

  const loadFacilities = useCallback(() => {
    api.get<Facility[]>(`/facilities?lease_id=${leaseId}&include_ended=true`).then(setFacilities).catch(() => setFacilities([]));
  }, [leaseId]);

  useEffect(() => {
    api
      .get<Lease>(`/leases/${leaseId}`)
      .then(async (l) => {
        setLease(l);
        api.get<Tenant>(`/tenants/${l.tenant_id}`).then(setTenant).catch(() => {});
        api.get<Room>(`/rooms/${l.room_id}`).then(async (r) => {
          setRoom(r);
          api.get<Building[]>("/buildings").then((bs) => setBuilding(bs.find((b) => b.id === r.building_id) ?? null));
        }).catch(() => {});
        api.get<LeaseCharge[]>(`/leases/${leaseId}/charges`).then(setCharges).catch(() => {});
      })
      .catch((e) => setLoadError(e.message));
    api.get<{ kinds: FacilityTemplates }>("/facilities/templates").then((t) => setTemplates(t.kinds)).catch(() => {});
    loadRoommates();
    loadFacilities();
  }, [leaseId, loadRoommates, loadFacilities]);

  // ------------------------------------------------------------ roommates
  function openAddRoommate() {
    setRmEditingId(null);
    setRmForm({ ...emptyRoommate, moved_in_date: new Date().toISOString().slice(0, 10) });
    setRmError(null);
    setRmOpen(true);
  }

  function openEditRoommate(r: Roommate) {
    setRmEditingId(r.id);
    setRmForm({
      full_name: r.full_name,
      relationship: r.relationship ?? "",
      cnic: r.cnic ?? "",
      phone: r.phone ?? "",
      address: r.address ?? "",
      moved_in_date: r.moved_in_date,
    });
    setRmError(null);
    setRmOpen(true);
  }

  async function saveRoommate(e: React.FormEvent) {
    e.preventDefault();
    if (!lease) return;
    setRmSaving(true);
    setRmError(null);
    try {
      if (rmEditingId) {
        await api.patch(`/room-occupants/${rmEditingId}`, {
          full_name: rmForm.full_name,
          relationship: rmForm.relationship,
          cnic: rmForm.cnic,
          phone: rmForm.phone,
          address: rmForm.address,
        });
      } else {
        await api.post("/room-occupants", {
          tenant_id: lease.tenant_id,
          room_id: lease.room_id,
          full_name: rmForm.full_name,
          relationship: rmForm.relationship || undefined,
          cnic: rmForm.cnic || undefined,
          phone: rmForm.phone || undefined,
          address: rmForm.address || undefined,
          moved_in_date: rmForm.moved_in_date || undefined,
        });
      }
      setRmOpen(false);
      loadRoommates();
    } catch (err: any) {
      setRmError(err.message);
    } finally {
      setRmSaving(false);
    }
  }

  async function confirmRemove(e: React.FormEvent) {
    e.preventDefault();
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.post(`/room-occupants/${removeTarget.id}/remove`, {
        reason: removeReason,
        moved_out_date: removeDate || undefined,
      });
      setRemoveTarget(null);
      loadRoommates();
    } catch (err: any) {
      setRemoveError(err.message);
    } finally {
      setRemoving(false);
    }
  }

  // ----------------------------------------------------------- facilities
  const facilityKind: FacilityKind = classifyLabel(fLabelChoice === "__custom__" ? fCustomLabel : fLabelChoice);
  const template = templates?.[facilityKind];
  const resolvedLabel = (fLabelChoice === "__custom__" ? fCustomLabel : fLabelChoice).trim();

  // Charges on this lease (other than Rent) = what the tenant has opted into.
  const facilityCharges = Array.from(
    new Set(charges.filter((c) => c.label && c.label.trim().toLowerCase() !== "rent").map((c) => c.label.trim()))
  );
  const activeFacilities = (facilities ?? []).filter((f) => f.is_active);
  const endedFacilities = (facilities ?? []).filter((f) => !f.is_active);
  const chargesWithoutSpecs = facilityCharges.filter(
    (label) => !activeFacilities.some((f) => f.label.trim().toLowerCase() === label.toLowerCase())
  );

  function openAddFacility(prefillLabel?: string) {
    setFEditingId(null);
    setFLabelChoice(prefillLabel ?? (facilityCharges[0] ?? "__custom__"));
    setFCustomLabel("");
    setFSpecs({});
    setFExtras([]);
    setFNotes("");
    setFError(null);
    setFOpen(true);
  }

  function openEditFacility(f: Facility) {
    const known = templates?.[f.kind]?.fields.map((x) => x.key) ?? [];
    const specs: Record<string, string> = {};
    const extras: ExtraRow[] = [];
    Object.entries(f.specs ?? {}).forEach(([k, v]) => {
      if (known.includes(k)) specs[k] = String(v);
      else extras.push({ key: k, value: String(v) });
    });
    setFEditingId(f.id);
    const inCharges = facilityCharges.some((c) => c.toLowerCase() === f.label.toLowerCase());
    setFLabelChoice(inCharges ? facilityCharges.find((c) => c.toLowerCase() === f.label.toLowerCase())! : "__custom__");
    setFCustomLabel(inCharges ? "" : f.label);
    setFSpecs(specs);
    setFExtras(extras);
    setFNotes(f.notes ?? "");
    setFError(null);
    setFOpen(true);
  }

  async function saveFacility(e: React.FormEvent) {
    e.preventDefault();
    if (!lease) return;
    if (!resolvedLabel) {
      setFError("Choose or type a facility name.");
      return;
    }
    const specs: Record<string, string> = { ...fSpecs };
    for (const row of fExtras) {
      if (row.key.trim() || row.value.trim()) {
        if (!row.key.trim()) {
          setFError("Each extra detail needs a field name.");
          return;
        }
        specs[row.key.trim()] = row.value;
      }
    }
    setFSaving(true);
    setFError(null);
    try {
      if (fEditingId) {
        await api.patch(`/facilities/${fEditingId}`, { label: resolvedLabel, specs, notes: fNotes });
      } else {
        await api.post("/facilities", { lease_id: lease.id, label: resolvedLabel, specs, notes: fNotes || undefined });
      }
      setFOpen(false);
      loadFacilities();
    } catch (err: any) {
      setFError(err.message);
    } finally {
      setFSaving(false);
    }
  }

  async function confirmEndFacility() {
    if (!endTarget) return;
    setEnding(true);
    setEndError(null);
    try {
      await api.post(`/facilities/${endTarget.id}/end`, {});
      setEndTarget(null);
      loadFacilities();
    } catch (err: any) {
      setEndError(err.message);
    } finally {
      setEnding(false);
    }
  }

  // ----------------------------------------------------------------- view
  if (loadError) {
    return (
      <div className="space-y-4">
        <Link href="/leases" className="text-sm text-accent hover:underline">← Back to leases</Link>
        <Card><p className="text-sm text-stamp-red">Couldn&apos;t open this lease — {loadError}</p></Card>
      </div>
    );
  }

  const currentRoommates = (roommates ?? []).filter((r) => !r.moved_out_date);
  const pastRoommates = (roommates ?? []).filter((r) => r.moved_out_date);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leases" className="text-sm text-accent hover:underline">← Back to leases</Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-display font-semibold">Residents &amp; facilities</h1>
          {lease && <StampBadge status={lease.status} />}
        </div>
        <p className="text-sm text-ink/55 mt-1">
          {tenant?.full_name ?? "…"} — {building?.name ?? "…"}, room {room?.room_number ?? "…"}. The lease stays in
          the tenant&apos;s name; roommates are recorded here for verification and monitoring.
        </p>
      </div>

      {/* ------------------------------------------------ Roommates */}
      <Card
        title="Roommates"
        action={
          can("can_add_roommates") && leaseActive ? (
            <Button variant="secondary" onClick={openAddRoommate}>
              <Plus size={14} className="inline mr-1 -mt-0.5" />
              Add roommate
            </Button>
          ) : undefined
        }
      >
        {!leaseActive && lease && (
          <p className="text-xs text-ink/50 mb-3">This lease is no longer active, so roommates can&apos;t be added.</p>
        )}
        {roommates === null ? (
          <p className="text-sm text-ink/40">Loading…</p>
        ) : currentRoommates.length === 0 ? (
          <p className="text-sm text-ink/45">No roommates declared for this tenant.</p>
        ) : (
          <RoommateTable
            rows={currentRoommates}
            canEdit={can("can_edit_roommates")}
            canRemove={can("can_remove_roommates")}
            onEdit={openEditRoommate}
            onRemove={(r) => {
              setRemoveTarget(r);
              setRemoveReason("");
              setRemoveDate(new Date().toISOString().slice(0, 10));
              setRemoveError(null);
            }}
          />
        )}
        {pastRoommates.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <label className="flex items-center gap-2 text-xs text-ink/55">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
              Show {pastRoommates.length} former roommate{pastRoommates.length > 1 ? "s" : ""}
            </label>
            {showPast && (
              <div className="mt-3">
                <RoommateTable rows={pastRoommates} canEdit={false} canRemove={false} past />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ Facilities */}
      <Card
        title="Facilities & specifications"
        action={
          can("can_manage_facilities") && leaseActive ? (
            <Button variant="secondary" onClick={() => openAddFacility()}>
              <Plus size={14} className="inline mr-1 -mt-0.5" />
              Add facility details
            </Button>
          ) : undefined
        }
      >
        {chargesWithoutSpecs.length > 0 && leaseActive && (
          <div className="mb-4 rounded-card border border-brass/30 bg-brass/10 px-3 py-2.5 text-sm">
            <p className="font-medium mb-1">Billed on this lease but no details recorded yet</p>
            <div className="flex flex-wrap gap-2">
              {chargesWithoutSpecs.map((label) =>
                can("can_manage_facilities") ? (
                  <button
                    key={label}
                    onClick={() => openAddFacility(label)}
                    className="text-xs px-2.5 py-1 rounded-full border border-brass/40 bg-paper-card hover:border-brass-dark"
                  >
                    + {label}
                  </button>
                ) : (
                  <span key={label} className="text-xs px-2.5 py-1 rounded-full border border-brass/40">{label}</span>
                )
              )}
            </div>
          </div>
        )}

        {facilities === null ? (
          <p className="text-sm text-ink/40">Loading…</p>
        ) : activeFacilities.length === 0 ? (
          <p className="text-sm text-ink/45">No facility details recorded for this lease.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeFacilities.map((f) => (
              <div key={f.id} className="border border-border rounded-card p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-sm">{f.label}</p>
                  {can("can_manage_facilities") && (
                    <div className="flex gap-1 no-print">
                      <button onClick={() => openEditFacility(f)} title="Edit" className="p-1 rounded hover:bg-accent/5 text-ink/50 hover:text-ink">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => { setEndTarget(f); setEndError(null); }} title="End this facility" className="p-1 rounded hover:bg-accent/5 text-ink/50 hover:text-ink">
                        <Power size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <dl className="space-y-1">
                  {f.specs_display.map((d, i) => (
                    <div key={i} className="flex justify-between gap-3 text-sm">
                      <dt className="text-ink/50">{d.label}</dt>
                      <dd className="figures font-medium text-right">{formatSpecValue(d)}</dd>
                    </div>
                  ))}
                </dl>
                {f.notes && <p className="text-xs text-ink/55 mt-2 pt-2 border-t border-border">{f.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {endedFacilities.length > 0 && (
          <details className="mt-4 pt-3 border-t border-border text-xs text-ink/55">
            <summary className="cursor-pointer select-none">Ended facilities ({endedFacilities.length})</summary>
            <div className="mt-2 space-y-1.5">
              {endedFacilities.map((f) => (
                <div key={f.id} className="border-l-2 border-border pl-2">
                  {f.label} — {f.specs_display.map(formatSpecValue).join(", ") || "no details"} — ended {f.ended_on}
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* ------------------------------------------------ Roommate modal */}
      <Modal open={rmOpen} onClose={() => setRmOpen(false)} title={rmEditingId ? "Edit roommate" : "Add roommate"}>
        <form onSubmit={saveRoommate} className="space-y-4">
          <Field label="Full name">
            <Input required value={rmForm.full_name} onChange={(e) => setRmForm({ ...rmForm, full_name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Relationship (optional)">
              <Input placeholder="e.g. Brother, Friend" value={rmForm.relationship} onChange={(e) => setRmForm({ ...rmForm, relationship: e.target.value })} />
            </Field>
            {!rmEditingId && (
              <Field label="Moved in on">
                <Input type="date" value={rmForm.moved_in_date} onChange={(e) => setRmForm({ ...rmForm, moved_in_date: e.target.value })} />
              </Field>
            )}
          </div>
          <Field label="CNIC" hint="13 digits, e.g. 35202-1234567-1. Needed for the police record.">
            <Input value={rmForm.cnic} onChange={(e) => setRmForm({ ...rmForm, cnic: e.target.value })} placeholder="35202-1234567-1" />
          </Field>
          <Field label="Phone (optional)" hint="e.g. 0300-1234567">
            <Input value={rmForm.phone} onChange={(e) => setRmForm({ ...rmForm, phone: e.target.value })} placeholder="0300-1234567" />
          </Field>
          <Field label="Permanent address (optional)">
            <Input value={rmForm.address} onChange={(e) => setRmForm({ ...rmForm, address: e.target.value })} />
          </Field>
          {rmError && <p className="text-sm text-stamp-red">{rmError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setRmOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={rmSaving}>{rmSaving ? "Saving…" : rmEditingId ? "Save changes" : "Add roommate"}</Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------ Remove modal */}
      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title="Remove roommate">
        <form onSubmit={confirmRemove} className="space-y-4">
          <p className="text-sm text-ink/70">
            <span className="font-medium">{removeTarget?.full_name}</span> will be marked as moved out. The record is
            kept in the police register — nothing is deleted.
          </p>
          <Field label="Move-out date">
            <Input type="date" required value={removeDate} onChange={(e) => setRemoveDate(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input required value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="e.g. Moved to another city" />
          </Field>
          {removeError && <p className="text-sm text-stamp-red">{removeError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={removing}>{removing ? "Removing…" : "Remove roommate"}</Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------ Facility modal */}
      <Modal open={fOpen} onClose={() => setFOpen(false)} title={fEditingId ? "Edit facility details" : "Add facility details"}>
        <form onSubmit={saveFacility} className="space-y-4">
          <Field label="Facility">
            <Select value={fLabelChoice} onChange={(e) => { setFLabelChoice(e.target.value); setFSpecs({}); }}>
              {facilityCharges.map((l) => <option key={l} value={l}>{l}</option>)}
              <option value="__custom__">Other / not on the bill…</option>
            </Select>
          </Field>
          {fLabelChoice === "__custom__" && (
            <Field label="Facility name" hint="e.g. Parking, Internet, Generator, Locker">
              <Input required value={fCustomLabel} onChange={(e) => { setFCustomLabel(e.target.value); setFSpecs({}); }} />
            </Field>
          )}

          {template && template.fields.length > 0 && (
            <div className="space-y-3 pl-3 border-l-2 border-border">
              <p className="text-xs text-ink/50">{template.hint}</p>
              {template.fields.map((f) => (
                <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                  {f.type === "select" ? (
                    <Select value={fSpecs[f.key] ?? ""} onChange={(e) => setFSpecs({ ...fSpecs, [f.key]: e.target.value })}>
                      <option value="">—</option>
                      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : "text"}
                      min={f.type === "number" ? 0 : undefined}
                      step={f.type === "number" ? "any" : undefined}
                      placeholder={f.placeholder}
                      value={fSpecs[f.key] ?? ""}
                      onChange={(e) => setFSpecs({ ...fSpecs, [f.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
          )}
          {template && template.fields.length === 0 && <p className="text-xs text-ink/50">{template.hint}</p>}

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-ink/45 font-medium">Extra details (optional)</p>
            {fExtras.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input placeholder="Field, e.g. Capacity" value={row.key} onChange={(e) => setFExtras(fExtras.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
                <Input placeholder="Value, e.g. 5 kVA" value={row.value} onChange={(e) => setFExtras(fExtras.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
                <Button type="button" variant="ghost" onClick={() => setFExtras(fExtras.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={() => setFExtras([...fExtras, { key: "", value: "" }])}>+ Add a detail</Button>
          </div>

          <Field label="Notes (optional)">
            <Input value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
          </Field>
          {fError && <p className="text-sm text-stamp-red">{fError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setFOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={fSaving}>{fSaving ? "Saving…" : fEditingId ? "Save changes" : "Save details"}</Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------ End facility */}
      <Modal open={!!endTarget} onClose={() => setEndTarget(null)} title="End this facility?">
        <p className="text-sm text-ink/70 mb-4">
          <span className="font-medium">{endTarget?.label}</span>
          {endTarget && endTarget.specs_display.length > 0 && <> ({endTarget.specs_display.map(formatSpecValue).join(", ")})</>}{" "}
          will be marked as ended today. The record stays in history, and the vehicle/card number becomes available again.
        </p>
        {endError && <p className="text-sm text-stamp-red mb-3">{endError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEndTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmEndFacility} disabled={ending}>{ending ? "Ending…" : "End facility"}</Button>
        </div>
      </Modal>
    </div>
  );
}

function RoommateTable({
  rows,
  canEdit,
  canRemove,
  onEdit,
  onRemove,
  past = false,
}: {
  rows: Roommate[];
  canEdit: boolean;
  canRemove: boolean;
  onEdit?: (r: Roommate) => void;
  onRemove?: (r: Roommate) => void;
  past?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-ink/45 border-b border-border">
            <th className="py-2 pr-3 font-semibold">Name</th>
            <th className="py-2 pr-3 font-semibold">Relationship</th>
            <th className="py-2 pr-3 font-semibold">CNIC</th>
            <th className="py-2 pr-3 font-semibold">Phone</th>
            <th className="py-2 pr-3 font-semibold">{past ? "Stayed" : "Since"}</th>
            {!past && <th className="py-2 w-20" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 align-top">
              <td className="py-2.5 pr-3 font-medium">{r.full_name}</td>
              <td className="py-2.5 pr-3 text-ink/70">{r.relationship ?? "—"}</td>
              <td className="py-2.5 pr-3 figures text-ink/70">{r.cnic ?? "—"}</td>
              <td className="py-2.5 pr-3 figures text-ink/70">{r.phone ?? "—"}</td>
              <td className="py-2.5 pr-3 figures text-ink/70">
                {past ? (
                  <>
                    {r.moved_in_date} → {r.moved_out_date}
                    {r.removal_reason && <span className="block text-xs text-ink/45">{r.removal_reason}</span>}
                  </>
                ) : (
                  r.moved_in_date
                )}
              </td>
              {!past && (
                <td className="py-2.5 text-right no-print">
                  <div className="flex gap-1 justify-end">
                    {canEdit && (
                      <button onClick={() => onEdit?.(r)} title="Edit" className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink">
                        <Pencil size={15} />
                      </button>
                    )}
                    {canRemove && (
                      <button onClick={() => onRemove?.(r)} title="Remove roommate" className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-stamp-red">
                        <UserMinus size={15} />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
