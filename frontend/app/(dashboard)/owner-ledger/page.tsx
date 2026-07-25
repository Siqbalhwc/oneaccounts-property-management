"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type LedgerRow = {
  id: string;
  building_id: string;
  ledger_month: string;
  total_collected: number;
  total_expenses: number;
  amount_payable: number;
  amount_paid: number;
  status: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function OwnerLedgerPage() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

  const [computeModalOpen, setComputeModalOpen] = useState(false);
  const [computeSaving, setComputeSaving] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [computeForm, setComputeForm] = useState({
    building_id: "",
    month: new Date().toISOString().slice(0, 10),
  });

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<LedgerRow | null>(null);
  const [payForm, setPayForm] = useState({ amount_paid: "", paid_date: "" });

  // Filters
  const [filterOwner, setFilterOwner] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  function load() {
    api.get<LedgerRow[]>("/owner-ledger").then(setRows);
  }

  useEffect(() => {
    load();
    api.get<Building[]>("/buildings").then((data) => {
      setBuildings(data);
      setComputeForm((f) => (f.building_id ? f : { ...f, building_id: data[0]?.id ?? "" }));
    });
  }, []);

  async function handleCompute(e: React.FormEvent) {
    e.preventDefault();
    setComputeSaving(true);
    setComputeError(null);
    try {
      await api.post("/owner-ledger/compute", {
        building_id: computeForm.building_id,
        month: computeForm.month,
      });
      setComputeModalOpen(false);
      load();
    } catch (err: any) {
      setComputeError(err.message);
    } finally {
      setComputeSaving(false);
    }
  }

  function openPayModal(row: LedgerRow) {
    setActiveRow(row);
    setPayError(null);
    const remaining = Number(row.amount_payable) - Number(row.amount_paid || 0);
    setPayForm({
      amount_paid: String(remaining),
      paid_date: new Date().toISOString().slice(0, 10),
    });
    setPayModalOpen(true);
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!activeRow) return;
    setPaySaving(true);
    setPayError(null);
    try {
      // Total paid to date = whatever was already paid + this new payment,
      // since the backend's /pay endpoint records the running total paid.
      const alreadyPaid = Number(activeRow.amount_paid || 0);
      const newTotalPaid = alreadyPaid + parseFloat(payForm.amount_paid || "0");
      await api.post(`/owner-ledger/${activeRow.id}/pay`, {
        amount_paid: newTotalPaid,
        paid_date: payForm.paid_date,
      });
      setPayModalOpen(false);
      load();
    } catch (err: any) {
      setPayError(err.message);
    } finally {
      setPaySaving(false);
    }
  }

  const buildingById = (id: string) => buildings?.find((b) => b.id === id);
  const buildingName = (id: string) => buildingById(id)?.name ?? "—";
  const ownerName = (id: string) => buildingById(id)?.owner_name || "—";

  const owners = Array.from(
    new Set((buildings ?? []).map((b) => b.owner_name).filter((n): n is string => !!n))
  ).sort();

  const filteredRows = (rows ?? []).filter((r) => {
    if (filterBuilding && r.building_id !== filterBuilding) return false;
    if (filterOwner && ownerName(r.building_id) !== filterOwner) return false;
    if (filterMonth && !r.ledger_month.startsWith(filterMonth)) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Owner ledger</h1>
          <p className="text-sm text-ink/55 mt-1">
            What&apos;s payable to each building&apos;s owner, month by month.
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </Button>
          <Button onClick={() => setComputeModalOpen(true)}>Compute ledger</Button>
        </div>
      </div>

      <Card className="no-print">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Owner">
            <Select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)}>
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Building">
            <Select value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)}>
              <option value="">All buildings</option>
              {buildings?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month">
            <Input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <DataTable
          keyField="id"
          rows={filteredRows}
          emptyMessage="No ledger entries match these filters — try &quot;Compute ledger&quot; for a building and month."
          columns={[
            { header: "Owner", accessor: (r) => ownerName(r.building_id) },
            { header: "Building", accessor: (r) => buildingName(r.building_id) },
            { header: "Month", accessor: (r) => r.ledger_month },
            {
              header: "Collected",
              accessor: (r) => <span className="figures">{formatPkr(r.total_collected)}</span>,
              align: "right",
            },
            {
              header: "Expenses",
              accessor: (r) => <span className="figures">{formatPkr(r.total_expenses)}</span>,
              align: "right",
            },
            {
              header: "Payable",
              accessor: (r) => <span className="figures font-medium">{formatPkr(r.amount_payable)}</span>,
              align: "right",
            },
            {
              header: "Paid",
              accessor: (r) => (
                <span className="figures text-stamp-green">{formatPkr(r.amount_paid || 0)}</span>
              ),
              align: "right",
            },
            {
              header: "Balance",
              accessor: (r) => {
                const balance = Number(r.amount_payable) - Number(r.amount_paid || 0);
                return (
                  <span className={`figures font-medium ${balance > 0 ? "text-stamp-red" : ""}`}>
                    {formatPkr(balance)}
                  </span>
                );
              },
              align: "right",
            },
            { header: "Status", accessor: (r) => <StampBadge status={r.status} /> },
            {
              header: "",
              accessor: (r) =>
                r.status !== "paid" ? (
                  <Button variant="secondary" onClick={() => openPayModal(r)} className="no-print">
                    Record payout
                  </Button>
                ) : null,
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={computeModalOpen} onClose={() => setComputeModalOpen(false)} title="Compute ledger">
        <form onSubmit={handleCompute} className="space-y-4">
          <p className="text-xs text-ink/50">
            Sums up what was collected from tenants and what was spent on this
            building for the selected month, and works out what&apos;s owed to
            its owner.
          </p>
          <Field label="Building">
            <Select
              value={computeForm.building_id}
              onChange={(e) => setComputeForm({ ...computeForm, building_id: e.target.value })}
            >
              {buildings?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.owner_name ? `(Owner: ${b.owner_name})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month" hint="Any date within the month works.">
            <Input
              type="date"
              value={computeForm.month}
              onChange={(e) => setComputeForm({ ...computeForm, month: e.target.value })}
            />
          </Field>
          {computeError && <p className="text-sm text-stamp-red">{computeError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setComputeModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={computeSaving}>
              {computeSaving ? "Computing…" : "Compute"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={payModalOpen} onClose={() => setPayModalOpen(false)} title="Record payout to owner">
        <form onSubmit={handlePay} className="space-y-4">
          {activeRow && (
            <p className="text-xs text-ink/50 bg-ledger/5 border border-ledger/15 rounded-card px-3 py-2">
              Already paid: <span className="figures font-medium">{formatPkr(activeRow.amount_paid || 0)}</span>
              {" · "}
              Remaining: <span className="figures font-medium">
                {formatPkr(Number(activeRow.amount_payable) - Number(activeRow.amount_paid || 0))}
              </span>
            </p>
          )}
          <Field label="Amount to pay now">
            <AmountInput
              required
              value={payForm.amount_paid}
              onChange={(e) => setPayForm({ ...payForm, amount_paid: e.target.value })}
            />
          </Field>
          <Field label="Date paid">
            <Input
              type="date"
              required
              value={payForm.paid_date}
              onChange={(e) => setPayForm({ ...payForm, paid_date: e.target.value })}
            />
          </Field>
          {payError && <p className="text-sm text-stamp-red">{payError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPayModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={paySaving}>
              {paySaving ? "Saving…" : "Record payout"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
