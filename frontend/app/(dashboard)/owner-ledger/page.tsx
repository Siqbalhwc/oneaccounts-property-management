"use client";

import { useEffect, useState } from "react";
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
    setPayForm({
      amount_paid: String(row.amount_payable),
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
      await api.post(`/owner-ledger/${activeRow.id}/pay`, {
        amount_paid: parseFloat(payForm.amount_paid),
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

  const buildingName = (id: string) => buildings?.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Owner ledger</h1>
          <p className="text-sm text-ink/55 mt-1">
            What&apos;s payable to each building&apos;s owner, month by month.
          </p>
        </div>
        <Button onClick={() => setComputeModalOpen(true)}>Compute ledger</Button>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={rows ?? []}
          emptyMessage="No ledger entries yet — click &quot;Compute ledger&quot; to generate one for a building and month."
          columns={[
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
            { header: "Status", accessor: (r) => <StampBadge status={r.status} /> },
            {
              header: "",
              accessor: (r) =>
                r.status !== "paid" ? (
                  <Button variant="secondary" onClick={() => openPayModal(r)}>
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
                  {b.name}
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
          <Field label="Amount paid">
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
