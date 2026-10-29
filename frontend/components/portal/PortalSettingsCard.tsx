"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";

type Overview = { portal_code: string; permissions: Record<string, boolean>; permission_labels: Record<string, string> };
type BulkResult = { created: number; existing: number; skipped: { tenant_id: string; name: string | null; reason: string }[] };

/** The Tenant Portal's settings, shown inside Settings (folded by default): the sign-in link, what
 *  tenants may do by default, and creating logins for tenants who were added before the portal. */
export function PortalSettingsCard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bulk, setBulk] = useState<BulkResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    api.get<Overview>("/tenant-portal/overview").then((o) => { setOverview(o); setPerms(o.permissions); }).catch((e: any) => setError(e.message));
  }, []);

  const link = overview && typeof window !== "undefined" ? `${window.location.origin}/portal/${overview.portal_code}/login` : "";

  async function savePerms() {
    setSaving(true); setNotice(null); setError(null);
    try { await api.put("/tenant-portal/settings/permissions", { permissions: perms }); setNotice("Saved. These are now the default for every tenant."); }
    catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  async function bulkCreate() {
    setBulkBusy(true); setError(null);
    try { setBulk(await api.post<BulkResult>("/tenant-portal/accounts/bulk-create", {})); }
    catch (e: any) { setError(e.message); } finally { setBulkBusy(false); }
  }

  return (
    <CollapsibleCard title="Tenant portal" hint="Sign-in link, what tenants may do, and logins for existing tenants">
      {!overview ? (
        <p className="text-sm text-ink/50">{error ?? "Loading…"}</p>
      ) : (
        <div className="space-y-6">
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          {notice && <p className="text-sm text-accent">{notice}</p>}

          <section>
            <h4 className="text-sm font-medium mb-1">Your portal link</h4>
            <p className="text-sm text-ink/60 mb-2">Tenants open this link and sign in with their CNIC. It is the same for all your tenants.</p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <code className="text-sm bg-paper border border-border rounded-card px-3 py-2 break-all flex-1">{link}</code>
              <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </section>

          <section>
            <h4 className="text-sm font-medium mb-1">What tenants may do (default for all tenants)</h4>
            <div className="space-y-2 mt-2">
              {Object.entries(overview.permission_labels).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!perms[key]} onChange={(e) => setPerms({ ...perms, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink/45 mt-2">You can still change this for a single tenant from the Tenant portal page.</p>
            <div className="mt-3"><Button onClick={savePerms} loading={saving}>Save defaults</Button></div>
          </section>

          <section>
            <h4 className="text-sm font-medium mb-1">Logins for existing tenants</h4>
            <p className="text-sm text-ink/60 mb-2">
              New tenants get a login automatically. Use this once to give a login to tenants you added before the portal was switched on.
              Owner-occupied units, archived tenants and tenants without a CNIC are skipped.
            </p>
            <Button variant="secondary" onClick={bulkCreate} loading={bulkBusy}>Create logins for existing tenants</Button>
            {bulk && (
              <div className="text-sm bg-paper border border-border rounded-card px-3 py-2 mt-3">
                Created {bulk.created}, already had a login {bulk.existing}, skipped {bulk.skipped.length}.
                {bulk.skipped.length > 0 && <ul className="mt-1 list-disc pl-5 text-ink/60">{bulk.skipped.slice(0, 20).map((s) => <li key={s.tenant_id}>{s.name}: {s.reason}</li>)}</ul>}
                <p className="text-xs text-ink/45 mt-2">Open the Tenant portal page to see each tenant's login slip.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </CollapsibleCard>
  );
}
