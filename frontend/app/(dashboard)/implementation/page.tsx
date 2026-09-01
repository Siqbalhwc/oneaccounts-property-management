"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Profile } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";

type Project = {
  id: string;
  client_display_name: string;
  status: string;
  created_at: string;
};

type QueueItem = {
  id: string;
  status: string;
  implementation_projects: { client_display_name: string };
};

export default function ImplementationPortalPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<(Profile & { is_platform_admin?: boolean }) | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [queue, setQueue] = useState<{ invited: QueueItem[]; open: { id: string; client_display_name: string }[] } | null>(null);

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ client_display_name: "", primary_contact_name: "", primary_contact_phone: "" });

  useEffect(() => {
    api.get<Profile & { is_platform_admin?: boolean }>("/profile/me").then((p) => {
      setProfile(p);
      if (!p.is_platform_admin) {
        // Client login: there's exactly one project (their own company) --
        // RLS guarantees they can't see anyone else's. Jump straight in.
        api.get<Project[]>("/implementation/projects").then((list) => {
          if (list.length > 0) router.replace(`/implementation/${list[0].id}`);
        });
      }
    });
  }, [router]);

  function load() {
    api.get<Project[]>("/implementation/projects").then(setProjects);
    api.get<typeof queue>("/implementation/queue").then(setQueue);
  }

  useEffect(() => {
    if (profile?.is_platform_admin) load();
  }, [profile]);

  async function handleAccept(assignmentId: string) {
    await api.post(`/implementation/assignments/${assignmentId}/respond`, { decision: "accepted" });
    load();
  }
  async function handleDecline(assignmentId: string) {
    await api.post(`/implementation/assignments/${assignmentId}/respond`, { decision: "declined" });
    load();
  }
  async function handleClaim(projectId: string) {
    await api.post(`/implementation/projects/${projectId}/assignments/claim`, {});
    router.push(`/implementation/${projectId}`);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<Project>("/implementation/projects", form);
      setNewModalOpen(false);
      router.push(`/implementation/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return null;
  if (!profile.is_platform_admin) {
    return <p className="text-sm text-ink/45 py-12 text-center">Loading your engagement…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">All Engagements</h1>
          <p className="text-sm text-ink/55 mt-1">
            Every client currently going through onboarding — engagement, demo, requirements, UAT, go-live.
          </p>
        </div>
        <Button onClick={() => setNewModalOpen(true)}>+ New engagement</Button>
      </div>

      {queue && queue.invited.length + queue.open.length > 0 && (
        <Card>
          <h3 className="font-display font-semibold text-[15px] mb-3">Needs a consultant</h3>
          <div className="space-y-2">
            {queue.invited.map((q) => (
              <div key={q.id} className="flex items-center justify-between border border-dashed border-border rounded-card px-4 py-3 bg-brass/5">
                <div>
                  <p className="font-medium text-sm">{q.implementation_projects.client_display_name}</p>
                  <p className="text-xs text-ink/45 mt-0.5">You've been personally assigned to this one.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => handleDecline(q.id)}>
                    Decline
                  </Button>
                  <Button onClick={() => handleAccept(q.id)}>Accept</Button>
                </div>
              </div>
            ))}
            {queue.open.map((p) => (
              <div key={p.id} className="flex items-center justify-between border border-dashed border-border rounded-card px-4 py-3 bg-brass/5">
                <div>
                  <p className="font-medium text-sm">{p.client_display_name}</p>
                  <p className="text-xs text-ink/45 mt-0.5">Open — first to accept takes it.</p>
                </div>
                <Button onClick={() => handleClaim(p.id)}>Accept &amp; open</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <DataTable
          keyField="id"
          rows={projects ?? []}
          emptyMessage="No engagements yet — click 'New engagement' to start one."
          columns={[
            {
              header: "Client",
              accessor: (p) => <span className="font-medium">{p.client_display_name}</span>,
            },
            { header: "Status", accessor: (p) => <StampBadge status={p.status} /> },
            { header: "Started", accessor: (p) => new Date(p.created_at).toLocaleDateString() },
            {
              header: "",
              accessor: (p) => (
                <Button variant="ghost" onClick={() => router.push(`/implementation/${p.id}`)}>
                  Open →
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={newModalOpen} onClose={() => setNewModalOpen(false)} title="New engagement">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Client / building name">
            <Input
              required
              value={form.client_display_name}
              onChange={(e) => setForm({ ...form, client_display_name: e.target.value })}
              placeholder="e.g. Zaraj Residency Block C"
            />
          </Field>
          <Field label="Primary contact name">
            <Input
              value={form.primary_contact_name}
              onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })}
            />
          </Field>
          <Field label="Primary contact phone">
            <Input
              value={form.primary_contact_phone}
              onChange={(e) => setForm({ ...form, primary_contact_phone: e.target.value })}
            />
          </Field>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <p className="text-xs text-ink/45">
            This creates their real company (with a starter chart of accounts) right away, plus the 5 fixed stages —
            you can assign a consultant now or leave it in the open queue.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setNewModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create engagement"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
