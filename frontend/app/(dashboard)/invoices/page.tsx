"use client";

import { useEffect, useState } from "react";
import { api, Invoice, Lease, fetchPdfBlob } from "@/lib/api";
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
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  useEffect(load, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.post("/invoices/generate", { month: today, due_in_days: 7 });
      load();
    } finally {
      setGenerating(false);
    }
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
      // The tenant behind this invoice comes from its lease.
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Invoices</h1>
          <p className="text-sm text-ink/55 mt-1">
            Generated monthly from each lease&apos;s active rent structure.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating…" : "Generate this month's invoices"}
        </Button>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={invoices ?? []}
          emptyMessage="No invoices generated yet."
          columns={[
            { header: "Month", accessor: (i) => i.invoice_month },
            { header: "Due date", accessor: (i) => i.due_date },
            {
              header: "Amount",
              accessor: (i) => <span className="figures">{formatPkr(i.total_amount)}</span>,
              align: "right",
            },
            { header: "Status", accessor: (i) => <StampBadge status={i.status} /> },
            {
              header: "",
              accessor: (i) => (
                <div className="flex items-center justify-end gap-1">
                  {i.status !== "paid" && (
                    <Button variant="secondary" onClick={() => openPaymentModal(i)}>
                      Record payment
                    </Button>
                  )}
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
