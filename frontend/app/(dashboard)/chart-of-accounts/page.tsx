"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { api } from "@/lib/api";

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  transfers_to_owner: boolean;
  is_system: boolean;
};

type ChargeMapping = {
  id: string;
  label: string;
  account_id: string;
};

const TYPE_LABELS: Record<Account["account_type"], string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [mappings, setMappings] = useState<ChargeMapping[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    code: "",
    name: "",
    account_type: "expense" as Account["account_type"],
    transfers_to_owner: false,
  });

  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingForm, setMappingForm] = useState({ label: "", account_id: "" });

  function load() {
    api
      .get<Account[]>("/chart-of-accounts")
      .then(setAccounts)
      .catch((err) => setError(err.message));
    api
      .get<ChargeMapping[]>("/chart-of-accounts/charge-mappings")
      .then(setMappings)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setAccountSaving(true);
    setAccountError(null);
    try {
      await api.post("/chart-of-accounts", accountForm);
      setAccountModalOpen(false);
      setAccountForm({ code: "", name: "", account_type: "expense", transfers_to_owner: false });
      load();
    } catch (err: any) {
      setAccountError(err.message);
    } finally {
      setAccountSaving(false);
    }
  }

  function openMappingModal() {
    setMappingError(null);
    setMappingForm({ label: "", account_id: accounts?.[0]?.id ?? "" });
    setMappingModalOpen(true);
  }

  async function handleSaveMapping(e: React.FormEvent) {
    e.preventDefault();
    setMappingSaving(true);
    setMappingError(null);
    try {
      await api.put("/chart-of-accounts/charge-mappings", mappingForm);
      setMappingModalOpen(false);
      load();
    } catch (err: any) {
      setMappingError(err.message);
    } finally {
      setMappingSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Chart of accounts</h1>
          <p className="text-sm text-ink/55 mt-1">
            Every account your ledger posts to, and which lease-charge labels
            (Rent, Parking, etc.) map to which account.
          </p>
        </div>
        <Button onClick={() => setAccountModalOpen(true)}>Add account</Button>
      </div>

      {error && (
        <Card className="border-stamp-red/40">
          <p className="text-sm text-stamp-red">Couldn&apos;t reach the API — {error}.</p>
        </Card>
      )}

      <Card title="Accounts">
        <DataTable
          keyField="id"
          rows={accounts ?? []}
          emptyMessage="No accounts yet."
          columns={[
            { header: "Code", accessor: (a) => <span className="figures">{a.code}</span> },
            { header: "Name", accessor: (a) => a.name },
            { header: "Type", accessor: (a) => TYPE_LABELS[a.account_type] },
            {
              header: "Transfers to owner",
              accessor: (a) =>
                a.transfers_to_owner ? (
                  <span className="text-stamp-green text-xs font-medium">Yes</span>
                ) : (
                  <span className="text-ink/40 text-xs">No</span>
                ),
            },
            {
              header: "",
              accessor: (a) =>
                a.is_system ? (
                  <span className="text-[10px] uppercase tracking-wide text-ink/35 border border-border rounded px-1.5 py-0.5">
                    System
                  </span>
                ) : null,
              align: "right",
            },
          ]}
        />
      </Card>

      <Card
        title="Charge label mappings"
        action={
          <Button variant="secondary" onClick={openMappingModal}>
            Add mapping
          </Button>
        }
      >
        <p className="text-xs text-ink/50 mb-3">
          When a lease charge (Rent, Parking Fee, Electricity Recovery…) is
          invoiced, this decides which account it posts to — and, since only
          Rent-Income-type accounts transfer to the owner, whether that money
          belongs to the building&apos;s owner or stays as company income.
          Any label without a mapping here falls back to Other Income
          automatically.
        </p>
        <DataTable
          keyField="id"
          rows={mappings ?? []}
          emptyMessage="No custom mappings yet — 'Rent' is mapped to Rent Income by default."
          columns={[
            { header: "Charge label", accessor: (m) => m.label },
            { header: "Posts to", accessor: (m) => accountName(m.account_id) },
          ]}
        />
      </Card>

      <Modal open={accountModalOpen} onClose={() => setAccountModalOpen(false)} title="Add account">
        <form onSubmit={handleAddAccount} className="space-y-4">
          <Field label="Code" hint="e.g. 5500 — pick something not already in use.">
            <Input
              required
              value={accountForm.code}
              onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input
              required
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <Select
              value={accountForm.account_type}
              onChange={(e) =>
                setAccountForm({ ...accountForm, account_type: e.target.value as Account["account_type"] })
              }
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transfers to owner?" hint="Only relevant for Income accounts — e.g. Rent Income should be Yes, everything else usually No.">
            <Select
              value={accountForm.transfers_to_owner ? "yes" : "no"}
              onChange={(e) => setAccountForm({ ...accountForm, transfers_to_owner: e.target.value === "yes" })}
            >
              <option value="no">No — stays as company income</option>
              <option value="yes">Yes — belongs to the building owner</option>
            </Select>
          </Field>
          {accountError && <p className="text-sm text-stamp-red">{accountError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAccountModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={accountSaving}>
              {accountSaving ? "Saving…" : "Add account"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={mappingModalOpen} onClose={() => setMappingModalOpen(false)} title="Map a charge label">
        <form onSubmit={handleSaveMapping} className="space-y-4">
          <Field label="Charge label" hint="Must match the label exactly as typed on the lease (e.g. 'Parking Fee').">
            <Input
              required
              value={mappingForm.label}
              onChange={(e) => setMappingForm({ ...mappingForm, label: e.target.value })}
            />
          </Field>
          <Field label="Posts to account">
            <Select
              value={mappingForm.account_id}
              onChange={(e) => setMappingForm({ ...mappingForm, account_id: e.target.value })}
            >
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </Select>
          </Field>
          {mappingError && <p className="text-sm text-stamp-red">{mappingError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setMappingModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mappingSaving}>
              {mappingSaving ? "Saving…" : "Save mapping"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
