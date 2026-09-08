"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Field, Input } from "@/components/ui/Field";
import { StampBadge } from "@/components/ui/StampBadge";
import { api } from "@/lib/api";

type CompanyOverview = {
  id: string;
  name: string;
  created_at: string;
  status: "active" | "suspended" | "pending";
  suspended_reason: string | null;
  suspended_at: string | null;
  max_users: number | null;
  building_count: number;
  tenant_count: number;
  room_count: number;
  occupied_room_count: number;
  user_count: number;
  suspended_user_count: number;
  income_this_month: number;
};

type CompanyUser = {
  id: string;
  full_name: string;
  role: string;
  phone: string | null;
  is_suspended: boolean;
  suspended_at: string | null;
  created_at: string;
};

type FeatureFlag = {
  id: string;
  feature_key: string;
  enabled: boolean;
};

type CompanyDetail = {
  company: CompanyOverview & { address?: string; phone?: string };
  users: CompanyUser[];
  feature_flags: FeatureFlag[];
};

type LoginLogEntry = {
  id: string;
  user_id: string | null;
  company_id: string | null;
  email: string | null;
  access_status: string;
  success: boolean;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

function shortUserAgent(ua: string | null): string {
  if (!ua) return "—";
  // Just enough to be useful at a glance (browser + OS), not the full string.
  const browser = ua.match(/(Chrome|Firefox|Safari|Edg|OPR)\/[\d.]+/)?.[0] ?? "";
  const os = ua.match(/\(([^)]+)\)/)?.[1]?.split(";")[0] ?? "";
  return [browser, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

export default function TowerPage() {
  const [companies, setCompanies] = useState<CompanyOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [featureKeys, setFeatureKeys] = useState<Record<string, string>>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [suspendTarget, setSuspendTarget] = useState<CompanyOverview | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [working, setWorking] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<CompanyOverview | null>(null);

  const [loginLog, setLoginLog] = useState<LoginLogEntry[] | null>(null);
  const [loginLogError, setLoginLogError] = useState<string | null>(null);
  const [showOnlyBlocked, setShowOnlyBlocked] = useState(false);

  function loadCompanies() {
    api
      .get<CompanyOverview[]>("/platform/companies")
      .then(setCompanies)
      .catch((e) => setError(e.message));
  }

  function loadLoginLog() {
    api
      .get<LoginLogEntry[]>("/platform/login-log")
      .then(setLoginLog)
      .catch((e) => setLoginLogError(e.message));
  }

  useEffect(() => {
    loadCompanies();
    loadLoginLog();
    api.get<Record<string, string>>("/platform/feature-keys").then(setFeatureKeys).catch(() => {});
  }, []);

  function openDetail(company: CompanyOverview) {
    setSelectedId(company.id);
    setDetailLoading(true);
    api
      .get<CompanyDetail>(`/platform/companies/${company.id}`)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setDetailLoading(false));
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
  }

  async function activateCompany(id: string) {
    setWorking(true);
    try {
      await api.post(`/platform/companies/${id}/activate`);
      loadCompanies();
      if (selectedId === id) openDetail({ id } as CompanyOverview);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  async function confirmSuspend() {
    if (!suspendTarget) return;
    setWorking(true);
    try {
      await api.post(`/platform/companies/${suspendTarget.id}/suspend`, { reason: suspendReason || null });
      setSuspendTarget(null);
      setSuspendReason("");
      loadCompanies();
      if (selectedId === suspendTarget.id) openDetail(suspendTarget);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  // Approving a pending signup reuses the same /activate endpoint as
  // reactivating a suspended company -- both just mean "set status =
  // 'active'". Nothing else needs to differ.
  async function approveCompany(company: CompanyOverview) {
    setWorking(true);
    try {
      await api.post(`/platform/companies/${company.id}/activate`);
      loadCompanies();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  // Rejecting a pending signup reuses /suspend with a fixed reason -- it
  // never had access to begin with, so this just makes sure it never gets
  // any, and the reason is visible if you (or they) look at it later.
  async function confirmReject() {
    if (!rejectTarget) return;
    setWorking(true);
    try {
      await api.post(`/platform/companies/${rejectTarget.id}/suspend`, {
        reason: "Signup rejected by platform admin",
      });
      setRejectTarget(null);
      loadCompanies();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  async function setUserLimit(id: string, value: string) {
    const max_users = value.trim() === "" ? null : parseInt(value, 10);
    if (max_users !== null && (Number.isNaN(max_users) || max_users < 1)) return;
    try {
      await api.put(`/platform/companies/${id}/user-limit`, { max_users });
      loadCompanies();
      if (selectedId === id) openDetail({ id } as CompanyOverview);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleFeature(companyId: string, featureKey: string, enabled: boolean) {
    try {
      await api.put(`/platform/companies/${companyId}/features`, { feature_key: featureKey, enabled });
      openDetail({ id: companyId } as CompanyOverview);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleUserSuspend(userId: string, suspend: boolean) {
    try {
      await api.post(`/platform/users/${userId}/${suspend ? "suspend" : "activate"}`);
      if (selectedId) openDetail({ id: selectedId } as CompanyOverview);
      loadCompanies();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const totals = (companies ?? []).reduce(
    (acc, c) => ({
      companies: acc.companies + 1,
      suspended: acc.suspended + (c.status === "suspended" ? 1 : 0),
      pending: acc.pending + (c.status === "pending" ? 1 : 0),
      buildings: acc.buildings + c.building_count,
      tenants: acc.tenants + c.tenant_count,
      income: acc.income + Number(c.income_this_month || 0),
    }),
    { companies: 0, suspended: 0, pending: 0, buildings: 0, tenants: 0, income: 0 }
  );

  const pendingCompanies = (companies ?? []).filter((c) => c.status === "pending");
  const visibleLoginLog = (loginLog ?? []).filter((row) => (showOnlyBlocked ? !row.success : true));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Tower</h1>
        <p className="text-sm text-ink/55 mt-1">
          A view across every company on the platform — visible only to you.
        </p>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">
            Couldn&apos;t load this — {error}. This page requires platform admin access.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Companies</p>
          <p className="text-2xl font-display font-semibold figures">{totals.companies}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Pending approval</p>
          <p className="text-2xl font-display font-semibold figures text-brass-dark">{totals.pending}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Suspended</p>
          <p className="text-2xl font-display font-semibold figures text-stamp-red">{totals.suspended}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Buildings</p>
          <p className="text-2xl font-display font-semibold figures">{totals.buildings}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">Tenants</p>
          <p className="text-2xl font-display font-semibold figures">{totals.tenants}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">
            Income this month (all companies)
          </p>
          <p className="text-2xl font-display font-semibold figures">{formatPkr(totals.income)}</p>
        </div>
      </div>

      {pendingCompanies.length > 0 && (
        <Card title="Pending approvals">
          <p className="text-sm text-ink/55 mb-3">
            New signups land here first — nobody at these companies can log in until
            you approve them.
          </p>
          <DataTable
            keyField="id"
            rows={pendingCompanies}
            emptyMessage="Nothing pending."
            columns={[
              { header: "Company", accessor: (c) => <span className="font-medium">{c.name}</span> },
              { header: "Signed up", accessor: (c) => c.created_at?.slice(0, 10) },
              { header: "Users", accessor: (c) => c.user_count, align: "right" },
              {
                header: "",
                accessor: (c) => (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRejectTarget(c);
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        approveCompany(c);
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                ),
                align: "right",
              },
            ]}
          />
        </Card>
      )}

      <Card title="Every company">
        <DataTable
          keyField="id"
          rows={companies ?? []}
          emptyMessage="No companies yet."
          onRowClick={openDetail}
          columns={[
            { header: "Company", accessor: (c) => <span className="font-medium">{c.name}</span> },
            { header: "Status", accessor: (c) => <StampBadge status={c.status} /> },
            {
              header: "Users",
              accessor: (c) => (c.max_users ? `${c.user_count} / ${c.max_users}` : c.user_count),
              align: "right",
            },
            { header: "Buildings", accessor: (c) => c.building_count, align: "right" },
            { header: "Tenants", accessor: (c) => c.tenant_count, align: "right" },
            {
              header: "Occupancy",
              accessor: (c) =>
                c.room_count > 0 ? `${Math.round((c.occupied_room_count / c.room_count) * 100)}%` : "—",
              align: "right",
            },
            {
              header: "Income this month",
              accessor: (c) => <span className="figures">{formatPkr(c.income_this_month)}</span>,
              align: "right",
            },
            { header: "Joined", accessor: (c) => c.created_at?.slice(0, 10) },
            {
              header: "",
              accessor: (c) => {
                if (c.status === "active") {
                  return (
                    <Button
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSuspendTarget(c);
                      }}
                    >
                      Suspend
                    </Button>
                  );
                }
                if (c.status === "pending") {
                  return (
                    <Button
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        approveCompany(c);
                      }}
                    >
                      Approve
                    </Button>
                  );
                }
                return (
                  <Button
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      activateCompany(c.id);
                    }}
                  >
                    Activate
                  </Button>
                );
              },
              align: "right",
            },
          ]}
        />
      </Card>

      <Card title="Login activity">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-ink/55">
            Every sign-in attempt across every company — who, when, and whether it
            went through.
          </p>
          <label className="flex items-center gap-2 text-xs text-ink/60 whitespace-nowrap shrink-0 ml-4">
            <input
              type="checkbox"
              checked={showOnlyBlocked}
              onChange={(e) => setShowOnlyBlocked(e.target.checked)}
            />
            Show only blocked attempts
          </label>
        </div>

        {loginLogError && (
          <p className="text-sm text-stamp-red mb-2">Couldn&apos;t load login activity — {loginLogError}.</p>
        )}

        <DataTable
          keyField="id"
          rows={visibleLoginLog}
          emptyMessage={loginLog === null ? "Loading…" : "No login attempts yet."}
          columns={[
            {
              header: "Time",
              accessor: (r) => (
                <span className="text-xs text-ink/70 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              ),
            },
            { header: "Email", accessor: (r) => r.email ?? "—" },
            {
              header: "Company",
              accessor: (r) => companies?.find((c) => c.id === r.company_id)?.name ?? "—",
            },
            {
              header: "Result",
              accessor: (r) =>
                r.success ? (
                  <StampBadge status="active" />
                ) : (
                  <span className="stamp stamp-overdue" title={r.access_status}>
                    Blocked — {r.access_status.replace("_", " ")}
                  </span>
                ),
            },
            { header: "IP address", accessor: (r) => r.ip_address ?? "—" },
            {
              header: "Device",
              accessor: (r) => <span className="text-xs text-ink/55">{shortUserAgent(r.user_agent)}</span>,
            },
          ]}
        />
      </Card>

      <ConfirmModal
        open={!!suspendTarget}
        onClose={() => {
          setSuspendTarget(null);
          setSuspendReason("");
        }}
        onConfirm={confirmSuspend}
        title={`Suspend ${suspendTarget?.name ?? "this company"}?`}
        message="Every user at this company will immediately lose access to all data — logins, invoices, ledger, everything. This takes effect on their very next request, not just their next login. You can reverse this any time."
        confirmLabel="Suspend company"
        confirming={working}
      />

      <ConfirmModal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={confirmReject}
        title={`Reject ${rejectTarget?.name ?? "this signup"}?`}
        message="This company never gets access — anyone who signed up under it will see a suspended/rejected message if they try to log in. You can still approve it later from the company list if this was a mistake."
        confirmLabel="Reject signup"
        confirming={working}
      />

      <Modal open={!!selectedId} onClose={closeDetail} title={detail?.company.name ?? "Company"} size="full">
        {detailLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {detail && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <StampBadge status={detail.company.status} />
              {detail.company.status === "suspended" && detail.company.suspended_reason && (
                <span className="text-sm text-ink/60">Reason: {detail.company.suspended_reason}</span>
              )}
            </div>

            <div>
              <h4 className="font-display text-sm font-semibold mb-2">Seat limit</h4>
              <div className="flex items-center gap-2 max-w-xs">
                <Input
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  defaultValue={detail.company.max_users ?? ""}
                  onBlur={(e) => setUserLimit(detail.company.id, e.target.value)}
                />
                <span className="text-xs text-ink/50 whitespace-nowrap">
                  {detail.company.user_count} in use
                </span>
              </div>
            </div>

            <div>
              <h4 className="font-display text-sm font-semibold mb-2">Feature flags</h4>
              <div className="space-y-2">
                {Object.entries(featureKeys).map(([key, label]) => {
                  const flag = detail.feature_flags.find((f) => f.feature_key === key);
                  const enabled = flag ? flag.enabled : true; // no row = enabled by default
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => toggleFeature(detail.company.id, key, e.target.checked)}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <h4 className="font-display text-sm font-semibold mb-2">Users</h4>
              <DataTable
                keyField="id"
                rows={detail.users}
                emptyMessage="No users yet."
                columns={[
                  { header: "Name", accessor: (u) => u.full_name },
                  { header: "Role", accessor: (u) => u.role },
                  { header: "Phone", accessor: (u) => u.phone || "—" },
                  {
                    header: "Status",
                    accessor: (u) => <StampBadge status={u.is_suspended ? "suspended" : "active"} />,
                  },
                  {
                    header: "",
                    accessor: (u) =>
                      u.is_suspended ? (
                        <Button variant="secondary" onClick={() => toggleUserSuspend(u.id, false)}>
                          Reactivate
                        </Button>
                      ) : (
                        <Button variant="danger" onClick={() => toggleUserSuspend(u.id, true)}>
                          Suspend
                        </Button>
                      ),
                    align: "right",
                  },
                ]}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
