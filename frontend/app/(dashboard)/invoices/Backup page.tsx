"use client";

import { useEffect, useRef, useState } from "react";
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

type GenerateResult = {
  created: number;
  skipped: number; // nothing to bill (no charges / lease doesn't overlap the month)
  alreadyInvoiced: number;
  failed: { lease_id: string; error: string }[];
  stopped: boolean; // cancelled, or aborted after repeated errors -- running again continues
};

const GENERATE_BATCH_SIZE = 100;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [generateProgress, setGenerateProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelGenerateRef = useRef(false);
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

  // Generates in slices of GENERATE_BATCH_SIZE leases instead of one giant
  // request (which the server's time limit killed -> "Failed to fetch").
  // Safe to retry or re-run at any point: the server skips any lease that
  // already has an invoice for the month, so nothing is ever duplicated.
  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    setGenerateResult(null);
    setGenerateProgress(null);
    cancelGenerateRef.current = false;

    const tally: GenerateResult = { created: 0, skipped: 0, alreadyInvoiced: 0, failed: [], stopped: false };
    const base = {
      month: generateForm.month,
      due_in_days: parseInt(generateForm.due_in_days, 10) || 7,
    };

    try {
      const plan = await api.post<{ lease_ids: string[]; total_active: number; already_invoiced: number }>(
        "/invoices/generate/plan",
        { ...base, building_id: generateForm.building_id || undefined }
      );
      tally.alreadyInvoiced = plan.already_invoiced;

      let pending = plan.lease_ids;
      const total = pending.length;
      let processed = 0;
      let stalls = 0;
      setGenerateProgress({ done: 0, total });

      while (pending.length > 0) {
        if (cancelGenerateRef.current) {
          tally.stopped = true;
          break;
        }
        const slice = pending.slice(0, GENERATE_BATCH_SIZE);
        const rest = pending.slice(GENERATE_BATCH_SIZE);

        let res: { created: string[]; skipped: string[]; failed: { lease_id: string; error: string }[]; remaining: string[] } | null = null;
        let lastErr: any = null;
        for (let attempt = 1; attempt <= 4 && !res; attempt++) {
          try {
            res = await api.post("/invoices/generate/batch", { ...base, lease_ids: slice });
          } catch (err: any) {
            lastErr = err;
            await sleep(1500 * attempt);
          }
        }
        if (!res) {
          tally.stopped = true;
          setGenerateError(
            `Stopped after repeated errors (${lastErr?.message ?? "network problem"}). Nothing is lost — click Generate again to continue from where it stopped.`
          );
          break;
        }

        tally.created += res.created.length;
        tally.skipped += res.skipped.length;
        tally.failed.push(...res.failed);
        const handled = res.created.length + res.skipped.length + res.failed.length;
        processed += handled;
        setGenerateProgress({ done: Math.min(processed, total), total });

        // Anything the server ran out of time for goes back on the queue.
        pending = [...res.remaining, ...rest];
        stalls = handled === 0 ? stalls + 1 : 0;
        if (stalls >= 3) {
          tally.stopped = true;
          setGenerateError("The server isn't making progress. Click Generate again in a minute to continue.");
          break;
        }
      }
      setGenerateResult(tally);
      load();
    } catch (err: any) {
      setGenerateError(err.message || "Couldn't start generation.");
      if (tally.created > 0) setGenerateResult({ ...tally, stopped: true });
      load();
    } finally {
      setGenerating(false);
    }
  }

  function openGenerateModal() {
    setGenerateError(null);
    setGenerateResult(null);
    setGenerateProgress(null);
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
          {generating && generateProgress && (
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-ledger transition-all"
                  style={{ width: `${generateProgress.total ? (generateProgress.done / generateProgress.total) * 100 : 100}%` }}
                />
              </div>
              <p className="text-xs text-ink/55 figures">
                {generateProgress.done.toLocaleString()} of {generateProgress.total.toLocaleString()} leases processed — keep this window open…
              </p>
            </div>
          )}
          {generateResult && (
            <div className="text-sm bg-accent/5 border border-accent/20 rounded-card px-3 py-2 space-y-1">
              <p className="text-stamp-green font-medium">
                {generateResult.created.toLocaleString()} invoice(s) created{generateResult.stopped ? " so far" : ""}.
              </p>
              {generateResult.alreadyInvoiced > 0 && (
                <p className="text-ink/50 text-xs">{generateResult.alreadyInvoiced.toLocaleString()} already had an invoice for that month.</p>
              )}
              {generateResult.skipped > 0 && (
                <p className="text-ink/50 text-xs">{generateResult.skipped.toLocaleString()} skipped (no active charges for that month).</p>
              )}
              {generateResult.failed.length > 0 && (
                <div className="text-xs text-stamp-red space-y-0.5">
                  <p className="font-medium">{generateResult.failed.length} could not be invoiced — click Generate again to retry them:</p>
                  {generateResult.failed.slice(0, 5).map((f) => (
                    <p key={f.lease_id} className="truncate">• {f.error}</p>
                  ))}
                  {generateResult.failed.length > 5 && <p>…and {generateResult.failed.length - 5} more.</p>}
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            {generating ? (
              <Button type="button" variant="ghost" onClick={() => (cancelGenerateRef.current = true)}>
                Stop
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setGenerateModalOpen(false)}>
                Close
              </Button>
            )}
            <Button type="submit" disabled={generating}>
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
