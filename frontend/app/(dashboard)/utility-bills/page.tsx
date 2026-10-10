"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { api, Building, downloadFile, uploadFileWithFields } from "@/lib/api";

type PreviewRow = {
  row: number;
  building: string;
  room: string;
  tenant: string;
  utility: string;
  lease_amount: number | null;
  amount: number | null;
  invoice_status: string | null;
  outcome: "update" | "stored" | "locked" | "error" | "blank";
  message: string;
  warnings: string[];
};

type Summary = { rows_checked: number; update: number; stored: number; locked: number; error: number; blank: number };

type PreviewResponse = { month: string; summary: Summary; rows: PreviewRow[]; savable: number };

type Outcome = { row: number; outcome: "updated" | "stored" | "locked" | "failed"; message: string; invoice_total: number | null };

type CommitResponse = {
  rows: PreviewRow[];
  outcomes: Outcome[];
  summary: Summary;
  total_groups: number;
  next_start: number | null;
};

type SavedBill = {
  id: string;
  building: string;
  room: string;
  tenant: string;
  utility: string;
  amount: number;
  bill_reference: string | null;
  invoice_status: string | null;
  saved_at: string | null;
};

const XLSX = "xlsx";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function invoiceLabel(status: string | null) {
  switch (status) {
    case null:
      return "Not generated yet";
    case "draft":
      return "Draft";
    case "sent":
      return "Sent to tenant";
    case "partial":
      return "Partly paid";
    case "paid":
      return "Paid";
    default:
      return status;
  }
}

const TAG = {
  ok: "bg-ledger/10 text-ledger-dark",
  info: "bg-accent/10 text-accent",
  warn: "bg-brass/15 text-brass-dark",
  bad: "bg-stamp-red/10 text-stamp-red",
};

function Tag({ kind, children }: { kind: keyof typeof TAG; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TAG[kind]}`}>{children}</span>;
}

export default function UtilityBillsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [buildingFilter, setBuildingFilter] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [file, setFile] = useState<File | null>(null);

  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [saved, setSaved] = useState(false);

  const [bills, setBills] = useState<SavedBill[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);

  useEffect(() => {
    api.get<Building[]>("/buildings").then(setBuildings).catch(() => undefined);
  }, []);

  function loadBills() {
    setBillsLoading(true);
    const params = new URLSearchParams({ month });
    if (buildingFilter) params.set("building_id", buildingFilter);
    api
      .get<SavedBill[]>(`/utility-bills?${params.toString()}`)
      .then(setBills)
      .catch(() => setBills([]))
      .finally(() => setBillsLoading(false));
  }

  useEffect(loadBills, [month, buildingFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetResult() {
    setPreview(null);
    setOutcomes({});
    setSaved(false);
    setError(null);
    setProgress(null);
  }

  async function downloadTemplate() {
    setError(null);
    const params = new URLSearchParams({ month });
    if (buildingFilter) params.set("building_id", buildingFilter);
    try {
      await downloadFile(`/utility-bills/template?${params.toString()}`, `utility_bills_${month.replace("-", "_")}.${XLSX}`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function checkFile() {
    if (!file) return;
    resetResult();
    setChecking(true);
    try {
      const result = await uploadFileWithFields<PreviewResponse>("/utility-bills/preview", file, { month });
      setPreview(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function saveRows() {
    if (!file || !preview) return;
    setSaving(true);
    setError(null);
    const collected: Record<number, Outcome> = {};
    let start = 0;
    try {
      // The server works through the file within its time limit and, if it
      // is a big file, says where to continue. Sending the same file again is safe.
      for (let guard = 0; guard < 200; guard++) {
        const res = await uploadFileWithFields<CommitResponse>("/utility-bills/commit", file, {
          month,
          start: String(start),
        });
        res.outcomes.forEach((o) => {
          collected[o.row] = o;
        });
        setOutcomes({ ...collected });
        if (res.next_start === null || res.next_start === undefined) break;
        start = res.next_start;
        setProgress(`Saving… ${start} of ${res.total_groups} leases done`);
      }
      setSaved(true);
      loadBills();
    } catch (err: any) {
      setOutcomes({ ...collected });
      setError(`${err.message} — anything already saved is kept. Check the file again and save to continue.`);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  const outcomeList = Object.values(outcomes);
  const updatedCount = outcomeList.filter((o) => o.outcome === "updated").length;
  const storedCount = outcomeList.filter((o) => o.outcome === "stored").length;
  const lockedCount = outcomeList.filter((o) => o.outcome === "locked").length;
  const failedCount = outcomeList.filter((o) => o.outcome === "failed").length;

  function whatHappens(r: PreviewRow) {
    const done = outcomes[r.row];
    if (done) {
      const kind = done.outcome === "failed" ? "bad" : done.outcome === "locked" ? "warn" : done.outcome === "stored" ? "info" : "ok";
      return (
        <div>
          <Tag kind={kind}>
            {done.outcome === "updated" ? "Invoice updated" : done.outcome === "stored" ? "Saved" : done.outcome === "locked" ? "Not applied" : "Failed"}
          </Tag>
          <div className="text-xs text-ink/55 mt-1">{done.message}</div>
        </div>
      );
    }
    const kind = r.outcome === "update" ? "ok" : r.outcome === "stored" ? "info" : r.outcome === "locked" ? "warn" : "bad";
    const title =
      r.outcome === "update"
        ? "Invoice will be updated"
        : r.outcome === "stored"
        ? "Will be saved"
        : r.outcome === "locked"
        ? "Not applied"
        : "Needs correction";
    return (
      <div>
        <Tag kind={kind}>{title}</Tag>
        <div className="text-xs text-ink/55 mt-1">{r.message}</div>
        {r.warnings.map((w) => (
          <div key={w} className="text-xs text-brass-dark mt-1">
            {w}
          </div>
        ))}
        {r.outcome === "update" && r.invoice_status === "sent" && (
          <div className="text-xs text-ink/55 mt-1">Already sent to the tenant. Resend the updated invoice afterwards.</div>
        )}
      </div>
    );
  }

  const visibleRows = (preview?.rows ?? []).filter((r) => r.outcome !== "blank");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Utility bills</h1>
        <p className="text-sm text-ink/55 mt-1 max-w-3xl">
          Upload the month&apos;s electricity, water, gas (or any other bill-based charge) from Excel. A bill replaces
          the lease amount on that month&apos;s invoice. Anything not in the file stays exactly as it is.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Step 1 — Choose month and download the template">
          <div className="space-y-3">
            <Field label="Bill month">
              <Input
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  resetResult();
                }}
              />
            </Field>
            <Field label="Building (optional)">
              <Select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
                <option value="">All buildings</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={downloadTemplate} className="w-full" disabled={!month}>
              Download Excel template
            </Button>
            <p className="text-xs text-ink/50">
              The template is pre-filled with every active lease: building, room, tenant and each lease&apos;s own utility
              names. You only type the bill amounts.
            </p>
          </div>
        </Card>

        <Card title="Step 2 — Upload the filled file">
          <div className="space-y-3">
            <Field label="Excel file (.xlsx)">
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  resetResult();
                }}
                className="block w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-card file:border file:border-border file:bg-transparent file:text-sm"
              />
            </Field>
            <Button variant="secondary" onClick={checkFile} disabled={!file || !month || checking || saving} loading={checking} className="w-full">
              Check file (nothing is saved yet)
            </Button>
            <p className="text-xs text-ink/50">You will see exactly what will change before anything is saved.</p>
          </div>
        </Card>

        <Card title="How it works">
          <ul className="text-sm text-ink/70 space-y-2 list-disc pl-5">
            <li>Invoice is draft or sent: the invoice is recalculated with your figure.</li>
            <li>Invoice not generated yet: the bill is stored and used when you generate it.</li>
            <li>Payment already recorded: the invoice is not touched and the row is reported.</li>
            <li>Room not found or no active lease: the row is skipped and the lease stays as it is.</li>
            <li>Uploading the same month again replaces the earlier figure. A bill of 0 removes that charge for the month.</li>
          </ul>
        </Card>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">{error}</p>
        </Card>
      )}

      {preview && (
        <Card title={saved ? "Result" : "Step 3 — Review before saving"}>
          <div className="flex flex-wrap gap-2 mb-4">
            {saved ? (
              <>
                <Tag kind="ok">{updatedCount} invoices updated</Tag>
                <Tag kind="info">{storedCount} saved for upcoming invoice</Tag>
                {lockedCount > 0 && <Tag kind="warn">{lockedCount} not applied (payment recorded)</Tag>}
                {failedCount > 0 && <Tag kind="bad">{failedCount} failed</Tag>}
                <Tag kind="bad">{preview.summary.error} skipped</Tag>
              </>
            ) : (
              <>
                <Tag kind="ok">{preview.summary.update} invoices will be updated</Tag>
                <Tag kind="info">{preview.summary.stored} saved for upcoming invoice</Tag>
                <Tag kind="warn">{preview.summary.locked} locked (payment recorded)</Tag>
                <Tag kind="bad">{preview.summary.error} need correction</Tag>
              </>
            )}
            {preview.summary.blank > 0 && <span className="text-xs text-ink/50 self-center">{preview.summary.blank} blank rows left unchanged</span>}
          </div>

          <DataTable
            keyField="row"
            rows={visibleRows}
            emptyMessage="No rows with an amount were found in this file."
            columns={[
              { header: "Row", accessor: (r) => r.row },
              { header: "Building", accessor: (r) => r.building },
              { header: "Room", accessor: (r) => r.room },
              { header: "Tenant", accessor: (r) => r.tenant || "—" },
              { header: "Utility", accessor: (r) => r.utility },
              { header: "Lease amount", align: "right", accessor: (r) => <span className="figures">{fmt(r.lease_amount)}</span> },
              { header: "Uploaded bill", align: "right", accessor: (r) => <span className="figures font-medium">{fmt(r.amount)}</span> },
              { header: "Invoice", accessor: (r) => invoiceLabel(r.invoice_status) },
              { header: "What will happen", accessor: whatHappens },
            ]}
          />

          {!saved && (
            <div className="mt-4 space-y-2">
              {preview.summary.error > 0 && (
                <p className="text-sm text-ink/70 bg-brass/10 border border-brass/30 rounded-card px-3 py-2">
                  Rows marked &quot;Needs correction&quot; will not be saved. You can correct the file and check it again,
                  or save the valid rows now and upload the rest later.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={saveRows} disabled={preview.savable === 0 || saving} loading={saving}>
                  Save {preview.savable} valid {preview.savable === 1 ? "row" : "rows"}
                </Button>
                <Button variant="ghost" onClick={resetResult} disabled={saving}>
                  Cancel
                </Button>
                {progress && <span className="text-xs text-ink/55">{progress}</span>}
                <span className="text-xs text-ink/50">Only owners and admins can save. Every invoice change is recorded in the audit log.</span>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title={`Saved bills — ${month}`}>
        <DataTable
          keyField="id"
          rows={bills}
          emptyMessage={billsLoading ? "Loading…" : "No utility bills saved for this month yet."}
          columns={[
            { header: "Building", accessor: (b) => b.building },
            { header: "Room", accessor: (b) => b.room },
            { header: "Tenant", accessor: (b) => b.tenant || "—" },
            { header: "Utility", accessor: (b) => b.utility },
            { header: "Bill", align: "right", accessor: (b) => <span className="figures">{fmt(b.amount)}</span> },
            { header: "Reference", accessor: (b) => b.bill_reference || "—" },
            { header: "Invoice", accessor: (b) => invoiceLabel(b.invoice_status) },
          ]}
        />
      </Card>
    </div>
  );
}
