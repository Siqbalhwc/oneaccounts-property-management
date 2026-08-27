"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Lease, Tenant, Room, Building, SecurityDeposit, Account, fetchPdfBlob } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { Field, Input, Select } from "@/components/ui/Field";

export default function LeasesPage() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [deposits, setDeposits] = useState<SecurityDeposit[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | null>(null);
  const [editForm, setEditForm] = useState({ start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receivingDeposit, setReceivingDeposit] = useState<SecurityDeposit | null>(null);
  const [receiveAccountId, setReceiveAccountId] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [printingDepositId, setPrintingDepositId] = useState<string | null>(null);

  function loadDeposits() {
    api.get<SecurityDeposit[]>("/security-deposits").then(setDeposits);
  }

  function load() {
    api.get<Lease[]>("/leases").then(setLeases);
  }

  useEffect(() => {
    load();
    loadDeposits();
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
  }, []);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? "—";
  const roomAndBuilding = (roomId: string) => {
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };
  const depositForLease = (leaseId: string) => deposits?.find((d) => d.lease_id === leaseId) ?? null;

  function openReceiveModal(deposit: SecurityDeposit) {
    setReceivingDeposit(deposit);
    setReceiveAccountId("");
    setReceiveDate(new Date().toISOString().slice(0, 10));
    setReceiveError(null);
    setReceiveModalOpen(true);
  }

  async function handleReceiveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!receivingDeposit) return;
    setReceiving(true);
    setReceiveError(null);
    try {
      await api.post(`/security-deposits/${receivingDeposit.id}/receive`, {
        account_id: receiveAccountId,
        received_date: receiveDate || undefined,
      });
      setReceiveModalOpen(false);
      loadDeposits();
    } catch (err: any) {
      setReceiveError(err.message);
    } finally {
      setReceiving(false);
    }
  }

  async function handlePrintReceipt(depositId: string) {
    setPrintingDepositId(depositId);
    try {
      const blob = await fetchPdfBlob(`/security-deposits/${depositId}/receipt-pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } finally {
      setPrintingDepositId(null);
    }
  }

  function openEditModal(lease: Lease) {
    setEditingLease(lease);
    setEditForm({ start_date: lease.start_date, end_date: lease.end_date });
    setError(null);
    setEditModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLease) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/leases/${editingLease.id}`, editForm);
      setEditModalOpen(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

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
            {
              header: "Security deposit",
              accessor: (l) => {
                const deposit = depositForLease(l.id);
                if (!deposit || Number(deposit.amount_received) <= 0) return "—";
                return (
                  <div className="flex items-center gap-2">
                    <span className="figures text-sm">Rs {Number(deposit.amount_received).toLocaleString("en-PK")}</span>
                    {deposit.is_received ? (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-ledger/10 text-ledger">
                          Received
                        </span>
                        <Button
                          variant="ghost"
                          className="no-print"
                          onClick={() => handlePrintReceipt(deposit.id)}
                          disabled={printingDepositId === deposit.id}
                        >
                          {printingDepositId === deposit.id ? "Opening…" : "Print receipt"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brass/15 text-brass">
                          Pending
                        </span>
                        <Button variant="secondary" className="no-print" onClick={() => openReceiveModal(deposit)}>
                          Record receipt
                        </Button>
                      </>
                    )}
                  </div>
                );
              },
            },
            {
              header: "",
              accessor: (l) => (
                <Button variant="ghost" onClick={() => openEditModal(l)} className="no-print">
                  Edit dates
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit lease dates">
        <form onSubmit={handleSave} className="space-y-4">
          <p className="text-xs text-ink/50">
            {editingLease && tenantName(editingLease.tenant_id)} — {editingLease && roomAndBuilding(editingLease.room_id)}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date">
              <Input
                type="date"
                required
                value={editForm.start_date}
                onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                required
                value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
              />
            </Field>
          </div>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
          {editingLease && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">History</p>
              <HistoryPanel tableName="leases" recordId={editingLease.id} />
            </div>
          )}
        </form>
      </Modal>

      <Modal open={receiveModalOpen} onClose={() => setReceiveModalOpen(false)} title="Record security deposit receipt">
        <form onSubmit={handleReceiveSubmit} className="space-y-4">
          {receivingDeposit && (
            <p className="text-xs text-ink/50">
              Rs {Number(receivingDeposit.amount_received).toLocaleString("en-PK")} —{" "}
              {tenantName(leases?.find((l) => l.id === receivingDeposit.lease_id)?.tenant_id ?? "")}
            </p>
          )}
          <Field label="Received into which account?">
            <Select required value={receiveAccountId} onChange={(e) => setReceiveAccountId(e.target.value)}>
              <option value="">Select account…</option>
              {accounts
                .filter((a) => a.account_type === "asset")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Date received">
            <Input type="date" required value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
          </Field>
          {receiveError && <p className="text-sm text-stamp-red">{receiveError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setReceiveModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={receiving || !receiveAccountId}>
              {receiving ? "Saving…" : "Record receipt"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
