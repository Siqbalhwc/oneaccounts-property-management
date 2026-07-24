"use client";

import { useEffect, useState } from "react";
import { api, Tenant } from "@/lib/api";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";

// Pakistani CNIC: 13 digits total, e.g. 35202-1234567-1 (dashes optional)
function validateCnic(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 13) return "CNIC must be exactly 13 digits (e.g. 35202-1234567-1).";
  return null;
}

// Pakistani mobile: 11 digits with leading 0 (03XX-XXXXXXX) is the standard
// format; also accept 10 digits if the leading 0 was omitted.
function validatePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 && digits.length !== 10) {
    return "Enter a valid Pakistani mobile number (e.g. 0300-1234567).";
  }
  if (digits.length === 11 && !digits.startsWith("0")) {
    return "An 11-digit number should start with 0 (e.g. 0300-1234567).";
  }
  return null;
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", cnic: "", phone: "", email: "" });
  const [touched, setTouched] = useState({ cnic: false, phone: false });

  function load() {
    api.get<Tenant[]>("/tenants").then(setTenants);
  }

  useEffect(load, []);

  const cnicError = touched.cnic ? validateCnic(form.cnic) : null;
  const phoneError = touched.phone ? validatePhone(form.phone) : null;
  const canSubmit =
    form.full_name.trim() !== "" &&
    validateCnic(form.cnic) === null &&
    validatePhone(form.phone) === null;

  async function handleAddTenant(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ cnic: true, phone: true });
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/tenants", form);
      setModalOpen(false);
      setForm({ full_name: "", cnic: "", phone: "", email: "" });
      setTouched({ cnic: false, phone: false });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
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
          <Field label="CNIC" hint={cnicError ?? "e.g. 35202-1234567-1 (13 digits)"}>
            <Input
              required
              value={form.cnic}
              onChange={(e) => setForm({ ...form, cnic: e.target.value })}
              onBlur={() => setTouched({ ...touched, cnic: true })}
              placeholder="35202-1234567-1"
              className={cnicError ? "border-stamp-red" : ""}
            />
          </Field>
          <Field label="Phone" hint={phoneError ?? "e.g. 0300-1234567"}>
            <Input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onBlur={() => setTouched({ ...touched, phone: true })}
              placeholder="0300-1234567"
              className={phoneError ? "border-stamp-red" : ""}
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
            <Button type="submit" disabled={saving || !canSubmit}>
              {saving ? "Saving…" : "Add tenant"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
