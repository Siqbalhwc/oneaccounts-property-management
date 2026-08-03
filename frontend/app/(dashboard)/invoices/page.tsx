"use client";

import { useEffect, useState } from "react";
import { api, Invoice, Lease, Building, Tenant, Room, fetchPdfBlob } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sendingWhatsappId, setSendingWhatsappId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("");

  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<{ created: string[]; skipped_existing_or_no_charges: string[] } | null>(null);
  const [generateForm, setGenerateForm] = useState({
    month: new Date().toISOString().slice(0, 7) + "-15",
    building_id: "",
    due_in_days: "7",
  });

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "cash",
    notes: "",
  });

  function load() {
    api.get<Invoice[]>("/invoices").then(setInvoices);
  }

  useEffect(() => {
    load();
    api.get<Building[]>("/buildings").then(setBuildings);
    api.get<Lease[]>("/leases").then(setLeases);
    api.get<Tenant[]>("/tenants").then(setTenants);
    api.get<Room[]>("/rooms").then(setRooms);
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const result = await api.post<{ created: string[]; skipped_existing_or_no_charges: string[] }>(
        "/invoices/generate",
        {
          month: generateForm.month,
          building_id: generateForm.building_id || undefined,
          due_in_days: parseInt(generateForm.due_in_days, 10) || 7,
        }
      );
      setGenerateResult(result);
      load();
    } catch (err: any) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function openGenerateModal() {
    setGenerateError(null);
    setGenerateResult(null);
    setGenerateForm({
      month: new Date().toISOString().slice(0, 7) + "-15",
      building_id: "",
      due_in_days: "7",
    });
    setGenerateModalOpen(true);
  }

  async function handleViewPdf(invoiceId: string) {
    setDownloadingId(invoiceId);
    try {
      const blob = await fetchPdfBlob(`/invoices/${invoiceId}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSendWhatsapp(invoiceId: string) {
    setSendingWhatsappId(invoiceId);
    try {
      const result = await api.post<{ whatsapp_url: string }>(`/invoices/${invoiceId}/whatsapp-link`);
      window.open(result.whatsapp_url, "_blank");
      await api.post(`/invoices/${invoiceId}/mark-sent`, {});
      load();
    } catch (err: any) {
      alert(`Couldn't prepare the WhatsApp message: ${err.message}`);
    } finally {
      setSendingWhatsappId(null);
    }
  }

  function openPaymentModal(invoice: Invoice) {
    setActiveInvoice(invoice);
    setPaymentError(null);
    setPaymentForm({
      amount: String(invoice.total_amount),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: "cash",
      notes: "",
    });
    setPaymentModalOpen(true);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeInvoice) return;
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      const lease = await api.get<Lease>(`/leases/${activeInvoice.lease_id}`);
      await api.post("/payments", {
        invoice_id: activeInvoice.id,
        tenant_id: lease.tenant_id,
        amount: parseFloat(paymentForm.amount),
        payment_date: paymentForm.payment_date,
        payment_method: paymentForm.payment_method,
        notes: paymentForm.notes || undefined,
      });
      setPaymentModalOpen(false);
      load();
    } catch (err: any) {
      setPaymentError(err.message);
    } finally {
      setPaymentSaving(false);
    }
  }

  const leaseById = (id: string) => leases?.find((l) => l.id === id);
  const tenantName = (leaseId: string) => {
    const tenantId = leaseById(leaseId)?.tenant_id;
    return tenants?.find((t) => t.id === tenantId)?.full_name ?? "—";
  };
  const propertyAndRoom = (leaseId: string) => {
    const roomId = leaseById(leaseId)?.room_id;
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    return room ? `${building?.name ?? "—"} — ${room.room_number}` : "—";
  };

  const availableMonths = Array.from(new Set((invoices ?? []).map((i) => i.invoice_month.slice(0, 7)))).sort(
    (a, b) => b.localeCompare(a)
  );
  const filteredInvoices = (invoices ?? []).filter(
    (i) => !monthFilter || i.invoice_month.startsWith(monthFilter)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Invoices</h1>
          <p className="text-sm text-ink/55 mt-1">
            Generated monthly from each lease&apos;s active rent structure.
          </p>
        </div>
        <Button onClick={openGenerateModal}>Generate invoices</Button>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4 no-print">
          <div className="w-48">
            <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All months</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <DataTable
          keyField="id"
          rows={filteredInvoices}
          emptyMessage="No invoices generated yet."
          columns={[
            { header: "Month", accessor: (i) => i.invoice_month },
            { header: "Tenant", accessor: (i) => tenantName(i.lease_id) },
            { header: "Property / Room", accessor: (i) => propertyAndRoom(i.lease_id) },
            {
              header: "Amount",
              accessor: (i) => <span className="figures">{formatPkr(i.total_amount)}</span>,
              align: "right",
            },
            { header: "Status", accessor: (i) => <StampBadge status={i.status} /> },
            {
              header: "",
              accessor: (i) => (
                <div className="flex items-center justify-end gap-1 no-print">
                  {i.status !== "paid" && (
                    <Button variant="secondary" onClick={() => openPaymentModal(i)}>
                      Record payment
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => handleSendWhatsapp(i.id)}
                    disabled={sendingWhatsappId === i.id}
                  >
                    {sendingWhatsappId === i.id ? "Preparing…" : "Send via WhatsApp"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleViewPdf(i.id)}
                    disabled={downloadingId === i.id}
                  >
                    {downloadingId === i.id ? "Opening…" : "View / print PDF"}
                  </Button>
                </div>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={generateModalOpen} onClose={() => setGenerateModalOpen(false)} title="Generate invoices">
        <form onSubmit={handleGenerate} className="space-y-4">
          <Field label="Month" hint="Pick any month — including a past one, e.g. to bill a tenant added partway through last month.">
            <Input
              type="month"
              required
              value={generateForm.month.slice(0, 7)}
              onChange={(e) => setGenerateForm({ ...generateForm, month: e.target.value + "-15" })}
            />
          </Field>
          <Field label="Building (optional)" hint="Leave blank to generate for every building.">
            <Select
              value={generateForm.building_id}
              onChange={(e) => setGenerateForm({ ...generateForm, building_id: e.target.value })}
            >
              <option value="">All buildings</option>
              {buildings?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due in (days)">
            <Input
              type="number"
              value={generateForm.due_in_days}
              onChange={(e) => setGenerateForm({ ...generateForm, due_in_days: e.target.value })}
            />
          </Field>
          {generateError && <p className="text-sm text-stamp-red">{generateError}</p>}
          {generateResult && (
            <div className="text-sm bg-ledger/5 border border-ledger/20 rounded-card px-3 py-2 space-y-1">
              <p className="text-stamp-green font-medium">
                {generateResult.created.length} invoice(s) created.
              </p>
              {generateResult.skipped_existing_or_no_charges.length > 0 && (
                <p className="text-ink/50 text-xs">
                  {generateResult.skipped_existing_or_no_charges.length} skipped (already existed for that month, or no active charges).
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setGenerateModalOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={generating}>
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title={`Record payment — ${activeInvoice?.invoice_month ?? ""}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <Field label="Amount received">
            <AmountInput
              required
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
            />
          </Field>
          <Field label="Payment date">
            <Input
              type="date"
              required
              value={paymentForm.payment_date}
              onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
            />
          </Field>
          <Field label="Payment method">
            <Select
              value={paymentForm.payment_method}
              onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Notes (optional)">
            <Input
              value={paymentForm.notes}
              onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
            />
          </Field>
          {paymentError && <p className="text-sm text-stamp-red">{paymentError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={paymentSaving}>
              {paymentSaving ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
