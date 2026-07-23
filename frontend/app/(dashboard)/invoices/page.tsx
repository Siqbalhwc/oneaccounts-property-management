"use client";

import { useEffect, useState } from "react";
import { api, Invoice, fetchPdfBlob } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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
                <Button
                  variant="ghost"
                  onClick={() => handleViewPdf(i.id)}
                  disabled={downloadingId === i.id}
                >
                  {downloadingId === i.id ? "Opening…" : "View / print PDF"}
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      </Card>
    </div>
  );
}
