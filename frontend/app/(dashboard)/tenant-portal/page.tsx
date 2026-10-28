"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Field";
import { LoginSlipModal, LoginSlip } from "@/components/portal/LoginSlipModal";

type Overview = { portal_code: string; permissions: Record<string, boolean>; permission_labels: Record<string, string> };
type AccountRow = {
  account_id: string;
  tenant_id: string;
  tenant_name: string | null;
  username: string;
  status: "active" | "disabled" | "archived";
  must_change_password: boolean;
  last_login_at: string | null;
  locked: boolean;
  permission_overrides: Record<string, boolean>;
  tenant_archived: boolean;
};
type Missing = { tenant_id: string; tenant_name: string | null; reason: string };
type BulkResult = { created: number; existing: number; skipped: { tenant_id: string; name: string | null; reason: string }[] };

function statusText(a: AccountRow) {
  if (a.status === "archived") return "Archived";
  if (a.status === "disabled") return "Disabled";
  if (a.locked) return "Locked (too many attempts)";
  return a.must_change_password ? "Waiting for first login" : "Active";
}

export default function TenantPortalAdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState<BulkResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [slipTenantId, setSlipTenantId] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<AccountRow | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api.get<Overview>("/tenant-portal/overview").then((o) => { setOverview(o); setPerms(o.permissions); }).catch((e: any) => setError(e.message));
    api.get<{ accounts: AccountRow[]; missing: Missing[] }>("/tenant-portal/accounts")
      .then((r) => { setAccounts(r.accounts); setMissing(r.missing); })
      .catch((e: any) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const link = overview && typeof window !== "undefined" ? `${window.location.origin}/portal/${overview.portal_code}/login` : "";

  async function savePerms() {
    setSaving(true); setNotice(null); setError(null);
    try { await api.put("/tenant-portal/settings/permissions", { permissions: perms }); setNotice("Saved. These are now the default for every tenant."); }
    catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  async function bulkCreate() {
    setBulkBusy(true); setError(null);
    try { setBulk(await api.post<BulkResult>("/tenant-portal/accounts/bulk-create", {})); load(); }
    catch (e: any) { setError(e.message); } finally { setBulkBusy(false); }
  }
  async function setStatus(a: AccountRow, status: "active" | "disabled") {
    setError(null);
    try { await api.post(`/tenant-portal/accounts/${a.account_id}/status`, { status }); load(); } catch (e: any) { setError(e.message); }
  }
  async function resetAndShow(a: AccountRow) {
    setError(null);
    try { await api.post<LoginSlip>(`/tenant-portal/accounts/${a.account_id}/reset-password`, {}); setSlipTenantId(a.tenant_id); load(); }
    catch (e: any) { setError(e.message); }
  }
  function openOverrides(a: AccountRow) {
    setOverrideFor(a);
    const d: Record<string, string> = {};
    Object.keys(overview?.permission_labels ?? {}).forEach((k) => { d[k] = k in a.permission_overrides ? (a.permission_overrides[k] ? "allow" : "block") : "default"; });
    setDraft(d);
  }
  async function saveOverrides() {
    if (!overrideFor) return;
    const body: Record<string, boolean | null> = {};
    Object.entries(draft).forEach(([k, v]) => { body[k] = v === "default" ? null : v === "allow"; });
    try { await api.put(`/tenant-portal/accounts/${overrideFor.account_id}/permissions`, { overrides: body }); setOverrideFor(null); load(); }
    catch (e: any) { setError(e.message); }
  }

  if (error && !overview) return <p className="text-sm text-stamp-red">{error}</p>;
  if (!overview || !accounts) return <p className="text-sm text-ink/50">Loading…</p>;

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Tenant portal</h1>
        <p className="text-sm text-ink/55 mt-1">
          Every tenant you add gets a portal login automatically (username = their CNIC). Decide below what tenants are allowed to do.
        </p>
      </div>
      {error && <p className="text-sm text-stamp-red">{error}</p>}
      {notice && <p className="text-sm text-accent">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Your portal link">
          <p className="text-sm text-ink/60 mb-3">Tenants open this link and sign in with their CNIC. It is the same for all your tenants.</p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <code className="text-sm bg-paper border border-border rounded-card px-3 py-2 break-all flex-1">{link}</code>
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </Card>

        <Card title="What tenants may do (default for all tenants)">
          <div className="space-y-2">
            {Object.entries(overview.permission_labels).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!perms[key]} onChange={(e) => setPerms({ ...perms, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink/45 mt-3">You can still change this for any single tenant from the table below.</p>
          <div className="mt-3"><Button onClick={savePerms} loading={saving}>Save defaults</Button></div>
        </Card>
      </div>

      <Card
        title={`Portal accounts (${accounts.length})`}
        action={<Button variant="secondary" onClick={bulkCreate} loading={bulkBusy}>Create accounts for existing tenants</Button>}
      >
        {bulk && (
          <div className="text-sm bg-paper border border-border rounded-card px-3 py-2 mb-4">
            Created {bulk.created}, already had an account {bulk.existing}, skipped {bulk.skipped.length}.
            {bulk.skipped.length > 0 && <ul className="mt-1 list-disc pl-5 text-ink/60">{bulk.skipped.slice(0, 20).map((s) => <li key={s.tenant_id}>{s.name}: {s.reason}</li>)}</ul>}
          </div>
        )}
        <div className="overflow-x-auto">
          <DataTable
            keyField="account_id"
            rows={accounts}
            emptyMessage="No portal accounts yet. Add a tenant, or use the button above for existing tenants."
            columns={[
              { header: "Tenant", accessor: (a: AccountRow) => <span className={a.tenant_archived ? "opacity-50" : "font-medium"}>{a.tenant_name}</span> },
              { header: "Username (CNIC)", accessor: (a: AccountRow) => <span className="figures text-ink/70">{a.username}</span> },
              { header: "Status", accessor: (a: AccountRow) => <span className="text-xs">{statusText(a)}</span> },
              { header: "Last login", accessor: (a: AccountRow) => <span className="text-xs text-ink/60">{a.last_login_at ? new Date(a.last_login_at).toLocaleString() : "Never"}</span> },
              {
                header: "",
                align: "right",
                accessor: (a: AccountRow) => (
                  <div className="flex flex-wrap justify-end gap-1 no-print">
                    {a.status !== "archived" && a.must_change_password && <Button variant="ghost" onClick={() => setSlipTenantId(a.tenant_id)}>Login slip</Button>}
                    {a.status !== "archived" && <Button variant="ghost" onClick={() => resetAndShow(a)}>Reset password</Button>}
                    {a.status === "active" && <Button variant="ghost" onClick={() => setStatus(a, "disabled")}>Disable</Button>}
                    {a.status === "disabled" && <Button variant="ghost" onClick={() => setStatus(a, "active")}>Enable</Button>}
                    {a.status !== "archived" && <Button variant="ghost" onClick={() => openOverrides(a)}>Permissions</Button>}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Card>

      {missing.length > 0 && (
        <Card title={`Tenants without a portal account (${missing.length})`}>
          <ul className="text-sm space-y-1">
            {missing.map((m) => <li key={m.tenant_id}><span className="font-medium">{m.tenant_name}</span> <span className="text-ink/55">— {m.reason}</span></li>)}
          </ul>
        </Card>
      )}

      <LoginSlipModal tenantId={slipTenantId} onClose={() => setSlipTenantId(null)} />

      <Modal open={!!overrideFor} onClose={() => setOverrideFor(null)} title={`Permissions — ${overrideFor?.tenant_name ?? ""}`}>
        <div className="space-y-3">
          {Object.entries(overview.permission_labels).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm">{label}</span>
              <div className="w-40 shrink-0">
                <Select value={draft[key] ?? "default"} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
                  <option value="default">Company default</option>
                  <option value="allow">Always allow</option>
                  <option value="block">Always block</option>
                </Select>
              </div>
            </div>
          ))}
          <Button onClick={saveOverrides}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}
