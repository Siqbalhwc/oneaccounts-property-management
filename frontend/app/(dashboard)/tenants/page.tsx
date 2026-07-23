"use client";

import { useEffect, useState } from "react";
import { api, Tenant } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", cnic: "", phone: "", email: "" });

  function load() {
    api.get<Tenant[]>("/tenants").then(setTenants);
  }

  useEffect(load, []);

  async function handleAddTenant(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/tenants", form);
      setModalOpen(false);
      setForm({ full_name: "", cnic: "", phone: "", email: "" });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Tenants</h1>
          <p className="text-sm text-ink/55 mt-1">
            Identified by CNIC — a tenant&apos;s record follows them across every
            room they&apos;ve rented.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Add tenant</Button>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={tenants ?? []}
          emptyMessage="No tenants added yet."
          columns={[
            { header: "Name", accessor: (t) => <span className="font-medium">{t.full_name}</span> },
            { header: "CNIC", accessor: (t) => <span className="figures text-ink/70">{t.cnic}</span> },
            { header: "Phone", accessor: (t) => <span className="figures text-ink/70">{t.phone}</span> },
            { header: "Email", accessor: (t) => t.email ?? "—" },
          ]}
        />
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add tenant">
        <form onSubmit={handleAddTenant} className="space-y-4">
          <Field label="Full name">
            <Input
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="CNIC" hint="e.g. 35202-1234567-1">
            <Input
              required
              value={form.cnic}
              onChange={(e) => setForm({ ...form, cnic: e.target.value })}
              placeholder="35202-1234567-1"
            />
          </Field>
          <Field label="Phone">
            <Input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="0300-1234567"
            />
          </Field>
          <Field label="Email (optional)">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          {error && <p className="text-sm text-stamp-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add tenant"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
