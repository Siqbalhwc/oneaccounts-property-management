"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, AmountInput } from "@/components/ui/Field";
import { api, Lease, Tenant, Room, Building, Account, fetchPdfBlob } from "@/lib/api";

type Preview = {
  outstanding_prior_amount: number;
  outstanding_prior_detail: { invoice_month: string; balance: number }[];
  unbilled_gap_months: { invoice_month: string; amount: number; note: string }[];
  final_period_charges: { label: string; amount: number }[];
  final_period_total: number;
  final_period_already_billed: number;
  final_period_already_paid: number;
  move_out_month_has_existing_invoice: boolean;
  total_owed_by_tenant: number;
  deposit_agreed: number;
  deposit_paid: number;
  net_before_discount_and_deductions: number;
};

type DeductionLine = { reason: string; amount: string; account_id: string };

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function LeaseSettlementPage() {
  const params = useParams();
  const router = useRouter();
  const leaseId = params.id as string;

  const [lease, setLease] = useState<Lease | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [moveOutDate, setMoveOutDate] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [discountAmount, setDiscountAmount] = useState("");
  const [discountAccountId, setDiscountAccountId] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  const [deductions, setDeductions] = useState<DeductionLine[]>([]);
  const [showFullDetail, setShowFullDetail] = useState(true);
  const [closeReason, setCloseReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [doneSettlementId, setDoneSettlementId] = useState<string | null>(null);
  const [openingPdf, setOpeningPdf] = useState(false);

  useEffect(() => {
    api.get<Lease>(`/leases/${leaseId}`).then((l) => {
      setLease(l);
      api.get<Tenant>(`/tenants/${l.tenant_id}`).then(setTenant);
      api.get<Room>(`/rooms/${l.room_id}`).then((r) => {
        setRoom(r);
        api.get<Building>(`/buildings/${r.building_id}`).then(setBuilding);
      });
    });
    api.get<Account[]>("/chart-of-accounts").then(setAccounts);
  }, [leaseId]);

  const loadPreview = useCallback(() => {
    if (!moveOutDate) return;
    setPreviewLoading(true);
    setPreviewError(null);
    api
      .get<Preview>(`/leases/${leaseId}/settlement-preview?move_out_date=${moveOutDate}`)
      .then(setPreview)
      .catch((err) => setPreviewError(err.message))
      .finally(() => setPreviewLoading(false));
  }, [leaseId, moveOutDate]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  function addDeduction() {
    setDeductions((prev) => [...prev, { reason: "", amount: "", account_id: "" }]);
  }
  function updateDeduction(i: number, patch: Partial<DeductionLine>) {
    setDeductions((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function removeDeduction(i: number) {
    setDeductions((prev) => prev.filter((_, idx) => idx !== i));
  }

  const discountNum = parseFloat(discountAmount) || 0;
  const deductionsTotal = deductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
  const totalOwedAfterDiscount = preview ? Math.max(preview.total_owed_by_tenant - discountNum, 0) : 0;
  const projectedNet = preview
    ? round2(preview.deposit_paid - deductionsTotal - totalOwedAfterDiscount)
    : 0;

  function round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  const discountNeedsAccount = discountNum > 0 && !discountAccountId;
  const deductionsNeedAccount = deductions.some((d) => (parseFloat(d.amount) || 0) > 0 && !d.account_id);
  const canSubmit = !!preview && !previewLoading && !discountNeedsAccount && !deductionsNeedAccount && !submitting;

  async function handleFinalize() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.post<{ id: string }>(`/leases/${leaseId}/settlement`, {
        move_out_date: moveOutDate,
        discount_amount: discountNum,
        discount_account_id: discountAccountId || undefined,
        discount_reason: discountReason || undefined,
        deductions: deductions
          .filter((d) => (parseFloat(d.amount) || 0) > 0)
          .map((d) => ({ reason: d.reason, amount: parseFloat(d.amount), account_id: d.account_id })),
        show_full_detail_on_pdf: showFullDetail,
        reason: closeReason || undefined,
      });
      setDoneSettlementId(result.id);
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenPdf(settlementId: string) {
    setOpeningPdf(true);
    try {
      const blob = await fetchPdfBlob(`/leases/settlements/${settlementId}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } finally {
      setOpeningPdf(false);
    }
  }

  if (doneSettlementId) {
    const isRefund = projectedNet >= 0;
    return (
      <div className="max-w-2xl space-y-6">
        <Card>
          <div className="text-center py-6 space-y-4">
            <p className="text-sm text-ink/55">Lease closed</p>
            <h1 className="text-2xl font-display font-semibold">
              {tenant?.full_name} — {room?.room_number}
            </h1>
            <div
              className={`inline-block px-6 py-4 rounded-card text-lg font-display font-semibold ${
                isRefund ? "bg-accent/10 text-accent" : "bg-stamp-red/10 text-stamp-red"
              }`}
            >
              {isRefund ? "Net refund to tenant" : "Net amount still owed by tenant"}
              <div className="text-2xl mt-1 figures">{formatPkr(Math.abs(projectedNet))}</div>
            </div>
            <div className="flex justify-center gap-2 pt-4">
              <Button variant="secondary" onClick={() => router.push("/leases")}>
                Back to leases
              </Button>
              <Button onClick={() => handleOpenPdf(doneSettlementId)} disabled={openingPdf}>
                {openingPdf ? "Opening…" : "Open settlement statement"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1180px] mx-auto space-y-6">
      <div>
        <button onClick={() => router.push("/leases")} className="text-sm text-accent hover:underline mb-2">
          ← Back to leases
        </button>
        <h1 className="text-2xl font-display font-semibold">Close lease — settlement</h1>
        <p className="text-sm text-ink/55 mt-1">
          {tenant?.full_name ?? "—"} — {building?.name ?? "—"}, Apartment {room?.room_number ?? "—"}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        {/* Left column: the detail — rent & bills, discount, deposit deductions */}
        <div className="order-2 lg:order-1 space-y-6 min-w-0">
          {previewError && (
            <Card className="border-stamp-red/40">
              <p className="text-sm text-stamp-red">Couldn&apos;t compute the settlement — {previewError}.</p>
            </Card>
          )}

          {previewLoading && !preview && <p className="text-sm text-ink/40">Calculating…</p>}

          {preview && (
            <>
              <Card>
                <p className="text-sm font-medium mb-3">Rent &amp; bills</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink/60">Outstanding from previous months</span>
                    <span className="figures">{formatPkr(preview.outstanding_prior_amount)}</span>
                  </div>
                  {preview.outstanding_prior_detail.map((d) => (
                    <div key={d.invoice_month} className="flex justify-between pl-4 text-xs text-ink/45">
                      <span>{d.invoice_month}</span>
                      <span className="figures">{formatPkr(d.balance)}</span>
                    </div>
                  ))}
                  {preview.unbilled_gap_months.map((g) => (
                    <div key={g.invoice_month} className="flex justify-between pl-4 text-xs text-ink/45">
                      <span>{g.invoice_month} ({g.note})</span>
                      <span className="figures">{formatPkr(g.amount)}</span>
                    </div>
                  ))}

                  <div className="flex justify-between pt-2">
                    <span className="text-ink/60">
                      Current bill (final period, prorated to {moveOutDate})
                      {preview.move_out_month_has_existing_invoice && (
                        <span className="block text-xs text-ink/40">
                          Was billed as {formatPkr(preview.final_period_already_billed)} for the full month — will be corrected.
                        </span>
                      )}
                    </span>
                    <span className="figures">{formatPkr(preview.final_period_total)}</span>
                  </div>
                  {preview.final_period_charges.map((c) => (
                    <div key={c.label} className="flex justify-between pl-4 text-xs text-ink/45">
                      <span>{c.label}</span>
                      <span className="figures">{formatPkr(c.amount)}</span>
                    </div>
                  ))}

                  <div className="ledger-rule pt-2 flex justify-between font-semibold">
                    <span>Total owed by tenant</span>
                    <span className="figures">{formatPkr(preview.total_owed_by_tenant)}</span>
                  </div>
                </div>
              </Card>

              <Card>
                <p className="text-sm font-medium mb-3">Discount (optional)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Amount">
                    <AmountInput value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" />
                  </Field>
                  <Field label="Charge to account" hint={discountNeedsAccount ? "Required if a discount is entered." : undefined}>
                    <Select value={discountAccountId} onChange={(e) => setDiscountAccountId(e.target.value)}>
                      <option value="">Select account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Reason (optional)">
                    <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="e.g. Goodwill" />
                  </Field>
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">Security deposit</p>
                </div>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between">
                    <span className="text-ink/60">Agreed</span>
                    <span className="figures">{formatPkr(preview.deposit_agreed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">Actually paid</span>
                    <span className="figures">{formatPkr(preview.deposit_paid)}</span>
                  </div>
                </div>

                <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">Deduction lines (damages, etc.)</p>
                <div className="space-y-2">
                  {deductions.map((d, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                      <div className="sm:col-span-5">
                        <Input
                          placeholder="Reason — e.g. Wall damage"
                          value={d.reason}
                          onChange={(e) => updateDeduction(i, { reason: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <AmountInput placeholder="Amount" value={d.amount} onChange={(e) => updateDeduction(i, { amount: e.target.value })} />
                      </div>
                      <div className="sm:col-span-4">
                        <Select value={d.account_id} onChange={(e) => updateDeduction(i, { account_id: e.target.value })}>
                          <option value="">Charge to account…</option>
                          {accounts
                            .filter((a) => a.account_type === "income" || a.account_type === "expense")
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} · {a.name}
                              </option>
                            ))}
                        </Select>
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <Button type="button" variant="ghost" onClick={() => removeDeduction(i)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" onClick={addDeduction} className="mt-3">
                  + Add deduction
                </Button>
              </Card>
            </>
          )}
        </div>

        {/* Right column: move-out date, printed-statement choice, net total, actions — stays in view while the left side is reviewed */}
        <div className="order-1 lg:order-2 space-y-4 lg:sticky lg:top-6">
          <Card>
            <Field label="Move-out date" hint="Defaults to today — change it and the figures on the left recalculate automatically.">
              <Input type="date" value={moveOutDate} onChange={(e) => setMoveOutDate(e.target.value)} />
            </Field>
          </Card>

          {preview && (
            <>
              <Card>
                <p className="text-sm font-medium mb-3">Printed statement</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={showFullDetail} onChange={() => setShowFullDetail(true)} />
                    Show full line-item detail
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={!showFullDetail} onChange={() => setShowFullDetail(false)} />
                    Show only the net balance
                  </label>
                </div>
                <div className="mt-4">
                  <Field label="Note for this closing (optional)">
                    <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="e.g. Tenant relocating to another city" />
                  </Field>
                </div>
              </Card>

              <Card className="bg-accent/5 border-accent/20">
                <p className="text-sm font-medium">{projectedNet >= 0 ? "Net refund to tenant" : "Net amount still owed by tenant"}</p>
                <p className={`text-2xl font-display font-semibold figures mt-1 ${projectedNet >= 0 ? "text-accent" : "text-stamp-red"}`}>
                  {formatPkr(Math.abs(projectedNet))}
                </p>
                <p className="text-xs text-ink/50 mt-1">Deposit paid − deductions − discount − amount owed</p>
              </Card>

              {submitError && <p className="text-sm text-stamp-red">{submitError}</p>}

              <div className="space-y-2 pb-8">
                <Button onClick={handleFinalize} disabled={!canSubmit} className="w-full">
                  {submitting ? "Closing lease…" : "Close lease & generate statement"}
                </Button>
                <Button variant="ghost" onClick={() => router.push("/leases")} className="w-full">
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
