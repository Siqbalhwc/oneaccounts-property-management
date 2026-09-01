"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, Profile } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, AmountInput } from "@/components/ui/Field";
import { StampBadge } from "@/components/ui/StampBadge";
import { GanttChart, GanttStage } from "@/components/ui/GanttChart";
import { supabase } from "@/lib/supabaseClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

/**
 * The typed `api` wrapper (lib/api.ts) is built around JSON bodies, so file
 * uploads go through a small multipart helper instead -- same bearer token,
 * just a FormData body and no Content-Type header (the browser sets the
 * multipart boundary itself).
 */
async function uploadFile(path: string, file: File) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Upload failed");
  return res.json();
}

type Project = {
  id: string;
  company_id: string;
  client_display_name: string;
  status: string;
  stages: GanttStage[];
  assignments: { id: string; consultant_id: string; role_on_engagement: string; status: string }[];
};

type Requirement = {
  id: string;
  title: string;
  description?: string;
  status: string;
  entered_on_behalf: boolean;
  entered_for_name?: string;
  profiles?: { full_name: string };
  created_at: string;
};

type Stakeholder = { id: string; full_name: string; role: string; phone?: string };
type Attachment = { id: string; file_name: string; file_url: string };

const TABS = ["overview", "requirements", "stakeholders", "approvals"] as const;
type Tab = (typeof TABS)[number];

export default function ImplementationDetailPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [profile, setProfile] = useState<(Profile & { is_platform_admin?: boolean }) | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [stakeholders, setStakeholders] = useState<Stakeholder[] | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const [reqModalOpen, setReqModalOpen] = useState(false);
  const [reqForm, setReqForm] = useState({ title: "", description: "", entered_on_behalf: false, entered_for_name: "" });
  const [reqFile, setReqFile] = useState<File | null>(null);
  const [reqSaving, setReqSaving] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ full_name: "", email: "", role: "client_requester" });
  const [inviteSaving, setInviteSaving] = useState(false);

  const [approveNotes, setApproveNotes] = useState("");
  const [stageEditId, setStageEditId] = useState<string | null>(null);
  const [stageForm, setStageForm] = useState<any>({});

  function load() {
    api.get<Project>(`/implementation/projects/${projectId}`).then(setProject);
    api.get<Requirement[]>(`/implementation/projects/${projectId}/requirements`).then((reqs) => {
      setRequirements(reqs);
      reqs.forEach((r) => {
        api
          .get<Attachment[]>(`/implementation/requirements/${r.id}/attachments`)
          .then((a) => setAttachments((prev) => ({ ...prev, [r.id]: a })));
      });
    });
    api.get<Stakeholder[]>(`/implementation/projects/${projectId}/stakeholders`).then(setStakeholders);
  }

  async function handleAttach(requirementId: string, file: File) {
    await uploadFile(`/implementation/requirements/${requirementId}/attachments`, file);
    const a = await api.get<Attachment[]>(`/implementation/requirements/${requirementId}/attachments`);
    setAttachments((prev) => ({ ...prev, [requirementId]: a }));
  }

  useEffect(() => {
    api.get<Profile & { is_platform_admin?: boolean }>("/profile/me").then(setProfile);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isAdmin = !!profile?.is_platform_admin;
  const isApprover = profile?.role === "client_senior_approver";
  const isRequester = profile?.role === "client_requester";
  const canManageTeam = isAdmin;
  const canSeeTeamTab = isAdmin || isApprover;

  const finalStage = project?.stages.find((s) => s.sort_order === 5);
  const priorStagesDone = project?.stages.filter((s) => s.sort_order < 5).every((s) => s.status === "completed");

  async function handleAddRequirement(e: React.FormEvent) {
    e.preventDefault();
    setReqSaving(true);
    try {
      const created = await api.post<Requirement>(`/implementation/projects/${projectId}/requirements`, reqForm);
      if (reqFile) await handleAttach(created.id, reqFile);
      setReqModalOpen(false);
      setReqForm({ title: "", description: "", entered_on_behalf: false, entered_for_name: "" });
      setReqFile(null);
      load();
    } finally {
      setReqSaving(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteSaving(true);
    try {
      await api.post(`/implementation/projects/${projectId}/stakeholders`, inviteForm);
      setInviteOpen(false);
      setInviteForm({ full_name: "", email: "", role: "client_requester" });
      load();
    } finally {
      setInviteSaving(false);
    }
  }

  async function handleRemoveStakeholder(id: string) {
    await api.delete(`/implementation/stakeholders/${id}`);
    load();
  }

  async function handleSaveStage(e: React.FormEvent) {
    e.preventDefault();
    if (!stageEditId) return;
    await api.patch(`/implementation/stages/${stageEditId}`, stageForm);
    setStageEditId(null);
    load();
  }

  async function handleDecision(stageId: string, decision: "approved" | "changes_requested" | "rejected") {
    await api.post(`/implementation/stages/${stageId}/approve`, { decision, notes: approveNotes });
    setApproveNotes("");
    load();
  }

  if (!project) return <p className="text-sm text-ink/45 py-12 text-center">Loading…</p>;

  return (
    <div className="space-y-6">
      {isApprover && (
        <div className="bg-brass/10 border border-brass/25 rounded-card px-4 py-3 text-sm">
          You have final sign-off on this engagement — review each stage, then approve Go-Live when ready.
        </div>
      )}
      {isRequester && (
        <div className="bg-ledger/5 border border-ledger/15 rounded-card px-4 py-3 text-sm">
          Add requirements any time. Your senior approver gives the final Go-Live approval.
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">{project.client_display_name}</h1>
          <p className="text-sm text-ink/55 mt-1">
            <StampBadge status={project.status} />
          </p>
        </div>
        <div className="flex gap-2">
          {(isAdmin || isRequester) && <Button onClick={() => setReqModalOpen(true)}>+ Add requirement</Button>}
        </div>
      </div>

      <div className="flex gap-6 border-b border-border">
        {TABS.filter((t) => t !== "stakeholders" || canSeeTeamTab).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2.5 text-sm capitalize ${tab === t ? "border-b-2 border-brass-dark font-medium" : "text-ink/50"}`}
          >
            {t === "overview" ? "Overview & Gantt" : t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <Card>
            <GanttChart stages={project.stages} />
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {project.stages.map((s) => (
              <div key={s.id} className="card p-3">
                <p className="text-[10px] text-ink/40 font-medium">STAGE {s.sort_order}</p>
                <p className="text-[13px] font-semibold mb-2">{s.display_name}</p>
                <p className="text-[11px] text-ink/50">
                  Planned: {s.planned_start ?? "—"} – {s.planned_end ?? "—"}
                </p>
                {s.actual_start && (
                  <p className="text-[11px] text-ink/50">
                    Actual: {s.actual_start} – {s.actual_end ?? "ongoing"}
                  </p>
                )}
                <p className="text-[11px] figures mt-1">
                  Rs {s.budget_amount.toLocaleString()} {s.actual_amount > 0 && <>→ Rs {s.actual_amount.toLocaleString()}</>}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <StampBadge status={s.status} />
                  {isAdmin && (
                    <button
                      className="text-xs text-ink/40 hover:text-ink"
                      onClick={() => {
                        setStageEditId(s.id);
                        setStageForm({
                          planned_start: s.planned_start,
                          planned_end: s.planned_end,
                          actual_start: s.actual_start,
                          actual_end: s.actual_end,
                          budget_amount: s.budget_amount,
                          actual_amount: s.actual_amount,
                          status: s.status,
                        });
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "requirements" && (
        <div className="space-y-3">
          {(requirements ?? []).map((r) => (
            <Card key={r.id}>
              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="font-medium text-sm">{r.title}</p>
                  <p className="text-xs text-ink/45 mt-0.5">
                    {r.entered_on_behalf
                      ? isRequester
                        ? `Entered on your behalf by ${r.profiles?.full_name ?? "your consultant"}`
                        : `Entered by ${r.profiles?.full_name ?? "—"} on behalf of ${r.entered_for_name ?? "the client"}`
                      : `Entered by ${r.profiles?.full_name ?? "—"}`}
                  </p>
                </div>
                <StampBadge status={r.status} />
              </div>
              {r.description && <p className="text-xs text-ink/70 mt-2">{r.description}</p>}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {(attachments[r.id] ?? []).map((a) => (
                  <a
                    key={a.id}
                    href={a.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-ink/55 border border-border rounded-full px-2.5 py-1 bg-white hover:text-ink"
                  >
                    📎 {a.file_name}
                  </a>
                ))}
                <label className="text-[11px] text-ink/40 hover:text-ink cursor-pointer">
                  + Attach file
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleAttach(r.id, e.target.files[0])}
                  />
                </label>
              </div>
            </Card>
          ))}
          {requirements?.length === 0 && (
            <p className="text-sm text-ink/45 py-8 text-center border border-dashed border-border rounded-card">
              No requirements logged yet.
            </p>
          )}
        </div>
      )}

      {tab === "stakeholders" && canSeeTeamTab && (
        <div className="space-y-6">
          <Card>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-display font-semibold text-[15px]">Client-side users</h3>
              {canManageTeam && <Button onClick={() => setInviteOpen(true)}>+ Invite stakeholder</Button>}
            </div>
            {(stakeholders ?? []).map((s) => (
              <div key={s.id} className="flex justify-between items-center py-2.5 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">
                    {s.full_name}{" "}
                    <span className="text-[10px] uppercase tracking-wide text-ink/45 ml-1">
                      {s.role === "client_senior_approver" ? "Senior Approver" : "Requester"}
                    </span>
                  </p>
                </div>
                {canManageTeam && (
                  <Button variant="ghost" onClick={() => handleRemoveStakeholder(s.id)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </Card>

          {isAdmin && (
            <Card>
              <h3 className="font-display font-semibold text-[15px] mb-3">Internal team</h3>
              {project.assignments.map((a) => (
                <div key={a.id} className="flex justify-between items-center py-2.5 border-b border-border last:border-0 text-sm">
                  <span>
                    Consultant {a.consultant_id.slice(0, 8)} — {a.role_on_engagement}
                  </span>
                  <StampBadge status={a.status} />
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {tab === "approvals" && (
        <div className="space-y-6">
          {finalStage && (isApprover || isAdmin) && (
            <Card>
              <h3 className="font-display font-semibold text-[15px] mb-2">
                {finalStage.status === "completed" ? "Engagement complete" : "Go-Live gate"}
              </h3>
              {finalStage.status !== "completed" && (
                <>
                  <p className="text-xs text-ink/50 mb-3">
                    {priorStagesDone
                      ? "All prior stages are complete — approving here promotes the client's users to real access in the live app."
                      : "Locked until First Engagement, Demo, Requirement Analysis and UAT are all marked completed."}
                  </p>
                  <Field label="Notes (optional)">
                    <Input value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} />
                  </Field>
                  <div className="flex gap-2 mt-3">
                    <Button
                      disabled={!priorStagesDone || !isApprover}
                      onClick={() => handleDecision(finalStage.id, "approved")}
                    >
                      Approve &amp; go live
                    </Button>
                    {isApprover && (
                      <Button variant="ghost" onClick={() => handleDecision(finalStage.id, "changes_requested")}>
                        Request changes
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Add requirement modal */}
      <Modal open={reqModalOpen} onClose={() => setReqModalOpen(false)} title="Add requirement">
        <form onSubmit={handleAddRequirement} className="space-y-4">
          {isAdmin && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={reqForm.entered_on_behalf}
                onChange={(e) => setReqForm({ ...reqForm, entered_on_behalf: e.target.checked })}
              />
              Entering this on behalf of the client
            </label>
          )}
          {isAdmin && reqForm.entered_on_behalf && (
            <Field label="On behalf of">
              <Input
                value={reqForm.entered_for_name}
                onChange={(e) => setReqForm({ ...reqForm, entered_for_name: e.target.value })}
                placeholder="Client contact's name"
              />
            </Field>
          )}
          <Field label="Title">
            <Input required value={reqForm.title} onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })} />
          </Field>
          <Field label="Details">
            <Input
              value={reqForm.description}
              onChange={(e) => setReqForm({ ...reqForm, description: e.target.value })}
            />
          </Field>
          <Field label="Attachment (optional)">
            <Input type="file" onChange={(e) => setReqFile(e.target.files?.[0] ?? null)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setReqModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={reqSaving}>
              {reqSaving ? "Adding…" : "Add requirement"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Invite stakeholder modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a client-side user">
        <form onSubmit={handleInvite} className="space-y-4">
          <Field label="Full name">
            <Input required value={inviteForm.full_name} onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
              <option value="client_requester">Requester — requirements &amp; UAT</option>
              <option value="client_senior_approver">Senior Approver — progress + final sign-off</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={inviteSaving}>
              {inviteSaving ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit stage modal (admin only) */}
      <Modal open={!!stageEditId} onClose={() => setStageEditId(null)} title="Edit stage">
        <form onSubmit={handleSaveStage} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planned start">
              <Input type="date" value={stageForm.planned_start ?? ""} onChange={(e) => setStageForm({ ...stageForm, planned_start: e.target.value })} />
            </Field>
            <Field label="Planned end">
              <Input type="date" value={stageForm.planned_end ?? ""} onChange={(e) => setStageForm({ ...stageForm, planned_end: e.target.value })} />
            </Field>
            <Field label="Actual start">
              <Input type="date" value={stageForm.actual_start ?? ""} onChange={(e) => setStageForm({ ...stageForm, actual_start: e.target.value })} />
            </Field>
            <Field label="Actual end">
              <Input type="date" value={stageForm.actual_end ?? ""} onChange={(e) => setStageForm({ ...stageForm, actual_end: e.target.value })} />
            </Field>
            <Field label="Budget">
              <AmountInput value={String(stageForm.budget_amount ?? "")} onChange={(e) => setStageForm({ ...stageForm, budget_amount: parseFloat(e.target.value) || 0 })} />
            </Field>
            <Field label="Actual cost">
              <AmountInput value={String(stageForm.actual_amount ?? "")} onChange={(e) => setStageForm({ ...stageForm, actual_amount: parseFloat(e.target.value) || 0 })} />
            </Field>
          </div>
          <Field label="Status">
            <Select value={stageForm.status} onChange={(e) => setStageForm({ ...stageForm, status: e.target.value })}>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="blocked">Blocked</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setStageEditId(null)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
