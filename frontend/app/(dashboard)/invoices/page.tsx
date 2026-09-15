"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Invoice, Lease, Building, Tenant, Room, fetchPdfBlob } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { Banknote, Printer, Receipt } from "lucide-react";

function formatPkr(n: number) {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [printingReceiptId, setPrintingReceiptId] = useState<string | null>(null);
  const [sendingWhatsappId, setSendingWhatsappId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<{ created: string[]; skipped_existing_or_no_charges: string[] } | null>(null);
  const [generateForm, setGenerateForm] = useState({
    month: new Date().toISOString().slice(0, 7) + "-15",
    building_id: "",
    due_in_days: "7",
  });

  // leases is now derived from whichever invoices are actually loaded,
  // instead of a separate fetch of every lease the company has ever had --
  // every lease this page could possibly need to look up (tenantName,
  // propertyAndRoom above) is one referenced by a loaded invoice, so this
  // covers the exact same lookups as before.
  function load() {
    api.get<Invoice[]>("/invoices").then((data) => {
      setInvoices(data);
      const leaseIds = Array.from(new Set(data.map((i) => i.lease_id).filter(Boolean)));
      if (leaseIds.length > 0) {
        api.get<Lease[]>(`/leases?ids=${leaseIds.join(",")}`).then(setLeases);
      } else {
        setLeases([]);
      }
    });
  }

  useEffect(() => {
    load();
    // Archived buildings/tenants/rooms are still valid history for past
    // invoices (e.g. a room that's since been archived after the tenant
    // moved out) -- include_archived=true here so an invoice never loses
    // its room/tenant label, and stays findable by search, just because
    // the record behind it was later archived. Without this, GET /rooms
    // silently drops archived rooms (see app/crud/generic.py's default),
    // propertyAndRoom() falls back to "—" for that invoice, and both the
    // displayed column AND the free-text search below go blank/unmatched
    // for that room -- exactly the "room 202 not found, but tenant search
    // still works" symptom, since /tenants has the same default but that
    // tenant hadn't been archived.
    api.get<Building[]>("/buildings?include_archived=true").then(setBuildings);
    api.get<Tenant[]>("/tenants?include_archived=true").then(setTenants);
    api.get<Room[]>("/rooms?include_archived=true").then(setRooms);
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

  async function handlePrintReceipt(invoiceId: string) {
    setPrintingReceiptId(invoiceId);
    try {
      const blob = await fetchPdfBlob(`/invoices/${invoiceId}/receipt-pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err: any) {
      alert(err.message || "Couldn't open the receipt.");
    } finally {
      setPrintingReceiptId(null);
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

  const leaseById = (id: string) => leases?.find((l) => l.id === id);
  const tenantName = (leaseId: string) => {
    const tenantId = leaseById(leaseId)?.tenant_id;
    const tenant = tenants?.find((t) => t.id === tenantId);
    if (!tenant) return "—";
    return `${tenant.full_name}${tenant.is_archived ? " (archived)" : ""}`;
  };
  const propertyAndRoom = (leaseId: string) => {
    const roomId = leaseById(leaseId)?.room_id;
    const room = rooms?.find((r) => r.id === roomId);
    const building = buildings?.find((b) => b.id === room?.building_id);
    if (!room) return "—";
    return `${building?.name ?? "—"} — ${room.room_number}${room.is_archived ? " (archived)" : ""}`;
  };

  const availableMonths = Array.from(new Set((invoices ?? []).map((i) => i.invoice_month.slice(0, 7)))).sort(
    (a, b) => b.localeCompare(a)
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredInvoices = (invoices ?? []).filter((i) => {
    if (monthFilter && !i.invoice_month.startsWith(monthFilter)) return false;
    if (!normalizedSearch) return true;
    const haystacks = [i.invoice_number ?? "", tenantName(i.lease_id), propertyAndRoom(i.lease_id)];
    return haystacks.some((field) => field.toLowerCase().includes(normalizedSearch));
  });

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
        <div className="flex items-center justify-between mb-4 no-print gap-3 flex-wrap">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by invoice #, tenant, or property…"
            className="max-w-xs"
          />
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
          emptyMessage={searchTerm || monthFilter ? "No invoices match your search." : "No invoices generated yet."}
          columns={[
            { header: "Invoice #", accessor: (i) => <span className="figures text-xs">{i.invoice_number ?? "—"}</span> },
            { header: "Month", accessor: (i) => i.invoice_month },
            { header: "Tenant", accessor: (i) => tenantName(i.lease_id) },
            { header: "Property / Apartment", accessor: (i) => propertyAndRoom(i.lease_id) },
            {
              header: "Amount",
              accessor: (i) => <span className="figures">{formatPkr(i.total_amount)}</span>,
              align: "right",
            },
            { header: "Status", accessor: (i) => <StampBadge status={i.status} /> },
            {
              header: "",
              accessor: (i) => (
                <div className="flex gap-1 justify-end no-print">
                  {i.status !== "paid" && (
                    <button
                      onClick={() => router.push(`/receipts/new?lease_id=${i.lease_id}`)}
                      title="Receive payment"
                      className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink"
                    >
                      <Banknote size={16} />
                    </button>
                  )}
                  {(i.status === "paid" || i.status === "partial") && (
                    <button
                      onClick={() => handlePrintReceipt(i.id)}
                      disabled={printingReceiptId === i.id}
                      title="Print receipt"
                      className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink disabled:opacity-50"
                    >
                      <Receipt size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleSendWhatsapp(i.id)}
                    disabled={sendingWhatsappId === i.id}
                    title="Send via WhatsApp"
                    className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink disabled:opacity-50"
                  >
                    <WhatsAppIcon size={16} />
                  </button>
                  <button
                    onClick={() => handleViewPdf(i.id)}
                    disabled={downloadingId === i.id}
                    title="View / print PDF"
                    className="p-1.5 rounded hover:bg-accent/5 text-ink/50 hover:text-ink disabled:opacity-50"
                  >
                    <Printer size={16} />
                  </button>
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
            <div className="text-sm bg-accent/5 border border-accent/20 rounded-card px-3 py-2 space-y-1">
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
    </div>
  );
}
