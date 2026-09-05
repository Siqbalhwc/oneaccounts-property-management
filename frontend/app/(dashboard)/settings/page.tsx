"use client";

import { useEffect, useRef, useState } from "react";
import { api, uploadFile, Company, Profile } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type TeamMember = { id: string; full_name: string; role: string; phone?: string };

export default function SettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "staff",
  });

  function loadTeam() {
    api.get<TeamMember[]>("/company/team").then(setTeam);
  }

  useEffect(() => {
    api.get<Company>("/company/me").then(setCompany);
    api.get<Profile>("/profile/me").then(setProfile);
    loadTeam();
  }, []);

  async function saveCompany() {
    if (!company) return;
    setSavingCompany(true);
    try {
      await api.patch("/company/me", {
        name: company.name,
        address: company.address,
        phone: company.phone,
      });
      setMessage("Company details saved.");
    } finally {
      setSavingCompany(false);
    }
  }

  async function saveProfile() {
    if (!profile) return;
    setSavingProfile(true);
    try {
      await api.patch("/profile/me", { full_name: profile.full_name });
      setMessage("Your profile was updated.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const result = await uploadFile<{ logo_url: string }>("/company/logo", file);
      setCompany((prev) => (prev ? { ...prev, logo_url: result.logo_url } : prev));
      setMessage("Logo uploaded.");
    } catch (err: any) {
      setMessage(`Logo upload failed: ${err.message}`);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteSaving(true);
    setInviteError(null);
    try {
      await api.post("/company/team", inviteForm);
      setInviteModalOpen(false);
      setInviteForm({ full_name: "", email: "", password: "", role: "staff" });
      loadTeam();
    } catch (err: any) {
      setInviteError(err.message);
    } finally {
      setInviteSaving(false);
    }
  }

  if (!company || !profile) {
    return <p className="text-sm text-ink/50">Loading settings…</p>;
  }

  const canInvite = profile.role === "owner" || profile.role === "admin";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Settings</h1>
        <p className="text-sm text-ink/55 mt-1">
          Your company's name and logo appear on invoices and throughout the app.
        </p>
      </div>

      {message && (
        <div className="text-sm text-accent bg-accent/5 border border-accent/20 rounded-card px-4 py-2.5">
          {message}
        </div>
      )}

      <Card title="Company profile">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-card border border-border bg-paper flex items-center justify-center overflow-hidden shrink-0">
            {company.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo_url} alt="Company logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-xs text-ink/35">No logo</span>
            )}
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleLogoChange}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
            >
              {uploadingLogo ? "Uploading…" : "Upload logo"}
            </Button>
            <p className="text-xs text-ink/45 mt-1.5">PNG, JPEG, WEBP, or SVG.</p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label="Company name">
            <Input
              value={company.name}
              onChange={(e) => setCompany({ ...company, name: e.target.value })}
            />
          </Field>
          <Field label="Address">
            <Input
              value={company.address ?? ""}
              onChange={(e) => setCompany({ ...company, address: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={company.phone ?? ""}
              onChange={(e) => setCompany({ ...company, phone: e.target.value })}
            />
          </Field>
          <Button onClick={saveCompany} disabled={savingCompany}>
            {savingCompany ? "Saving…" : "Save company details"}
          </Button>
        </div>
      </Card>

      <Card title="Your profile">
        <div className="space-y-4">
          <Field label="Full name" hint="Shown in the top-right of every page.">
            <Input
              value={profile.full_name}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Input value={profile.role} disabled className="capitalize opacity-60" />
          </Field>
          <Button onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save my profile"}
          </Button>
        </div>
      </Card>

      <Card
        title="Team"
        action={
          canInvite ? (
            <Button variant="secondary" onClick={() => setInviteModalOpen(true)}>
              Add teammate
            </Button>
          ) : undefined
        }
      >
        <DataTable
          keyField="id"
          rows={team ?? []}
          emptyMessage="Just you so far."
          columns={[
            { header: "Name", accessor: (m) => m.full_name },
            { header: "Role", accessor: (m) => <span className="capitalize">{m.role}</span> },
            { header: "Phone", accessor: (m) => m.phone ?? "—" },
          ]}
        />
        {!canInvite && (
          <p className="text-xs text-ink/40 mt-3">
            Only an owner or admin can add new team members.
          </p>
        )}
      </Card>

      <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Add teammate">
        <form onSubmit={handleInvite} className="space-y-4">
          <p className="text-xs text-ink/50 bg-accent/5 border border-accent/15 rounded-card px-3 py-2">
            They&apos;ll join your company only — never anyone else&apos;s. Give them these
            credentials to sign in with.
          </p>
          <Field label="Full name">
            <Input
              required
              value={inviteForm.full_name}
              onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
            />
          </Field>
          <Field label="Temporary password" hint="At least 8 characters — share this with them securely.">
            <Input
              type="password"
              required
              minLength={8}
              value={inviteForm.password}
              onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={inviteForm.role}
              onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
            >
              <option value="staff">Staff</option>
              <option value="accountant">Accountant</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          {inviteError && <p className="text-sm text-stamp-red">{inviteError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setInviteModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={inviteSaving}>
              {inviteSaving ? "Adding…" : "Add teammate"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
