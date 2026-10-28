"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export type LoginSlip = {
  available: boolean;
  account_id?: string;
  tenant_name?: string;
  username?: string;
  temp_password?: string;
  portal_code?: string;
  whatsapp_phone?: string | null;
  reason?: string;
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** The tenant's first-login details. Shown automatically after adding a tenant, and from the
 *  "Portal login" button. The temporary password is worked out by the server on request and is
 *  never stored; once the tenant sets their own password it is no longer available. */
export function LoginSlipModal({ tenantId, onClose }: { tenantId: string | null; onClose: () => void }) {
  const [slip, setSlip] = useState<LoginSlip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setSlip(null);
    setError(null);
    if (!tenantId) return;
    api
      .get<LoginSlip>(`/tenant-portal/tenants/${tenantId}/slip`)
      .then(setSlip)
      .catch((e: any) => setError(e.message || "Couldn't load the login details."));
  }, [tenantId]);

  const link = slip?.portal_code && typeof window !== "undefined" ? `${window.location.origin}/portal/${slip.portal_code}/login` : "";

  async function reset() {
    if (!slip?.account_id) return;
    setBusy(true);
    setError(null);
    try {
      setSlip(await api.post<LoginSlip>(`/tenant-portal/accounts/${slip.account_id}/reset-password`, {}));
    } catch (e: any) {
      setError(e.message || "Couldn't reset the password.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked -- the value is on screen to copy by hand
    }
  }

  const message = slip?.available
    ? `Hello ${slip.tenant_name}, your tenant portal is ready.\nLink: ${link}\nUsername (your CNIC): ${slip.username}\nTemporary password: ${slip.temp_password}\nYou will be asked to choose your own password when you first sign in.`
    : "";

  function printSlip() {
    if (!slip?.available) return;
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    w.document.write(
      `<html><head><title>Tenant portal login</title></head><body style="font-family:Arial,sans-serif;padding:24px;max-width:420px">` +
        `<h2 style="margin:0 0 4px">Tenant portal login</h2><p style="color:#555;margin:0 0 16px">${esc(slip.tenant_name || "")}</p>` +
        `<p><b>Link</b><br>${esc(link)}</p><p><b>Username (your CNIC)</b><br>${esc(slip.username || "")}</p>` +
        `<p><b>Temporary password</b><br><span style="font-size:20px;letter-spacing:1px">${esc(slip.temp_password || "")}</span></p>` +
        `<p style="color:#555;font-size:13px">You will be asked to choose your own password when you first sign in.</p></body></html>`
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Modal open={!!tenantId} onClose={onClose} title="Tenant portal login">
      {!slip && !error && <p className="text-sm text-ink/55">Loading…</p>}
      {error && <p className="text-sm text-stamp-red mb-3">{error}</p>}
      {slip && !slip.available && (
        <div className="space-y-4">
          <p className="text-sm text-ink/70">{slip.reason}</p>
          {slip.account_id && (
            <Button onClick={reset} loading={busy}>
              Reset password
            </Button>
          )}
        </div>
      )}
      {slip?.available && (
        <div className="space-y-4">
          <p className="text-sm text-ink/60">
            Give these to <span className="font-medium text-ink">{slip.tenant_name}</span>. They will choose their own password the first time they sign in.
          </p>
          {[
            ["Link", link],
            ["Username (CNIC)", slip.username || ""],
            ["Temporary password", slip.temp_password || ""],
          ].map(([label, value]) => (
            <div key={label} className="flex items-end justify-between gap-3 border border-border rounded-card px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-ink/45">{label}</p>
                <p className="text-sm font-medium break-all figures">{value}</p>
              </div>
              <Button variant="ghost" onClick={() => copy(label, value)}>
                {copied === label ? "Copied" : "Copy"}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {slip.whatsapp_phone && (
              <a
                className="btn-secondary px-3 py-2 text-sm rounded-card border border-border hover:bg-paper"
                href={`https://wa.me/${slip.whatsapp_phone}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
              >
                Send on WhatsApp
              </a>
            )}
            <Button variant="secondary" onClick={printSlip}>
              Print slip
            </Button>
            <Button variant="ghost" onClick={reset} loading={busy}>
              Issue a new password
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
