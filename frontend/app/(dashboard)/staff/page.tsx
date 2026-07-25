"use client";

import { useEffect, useState } from "react";
import { Card, DataTable } from "@/components/ui/Card";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, AmountInput, Select } from "@/components/ui/Field";
import { api, Building } from "@/lib/api";

type Staff = {
  id: string;
  building_id?: string;
  full_name: string;
  designation?: string;
  phone?: string;
  joining_date?: string;
  monthly_salary: number;
  status: string;
};
type SalaryPayment = {
  id: string;
  staff_id: string;
  salary_month: string;
  amount_paid: number;
  payment_date: string;
};

function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[] | null>(null);

  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState({
    full_name: "",
    designation: "",
    phone: "",
    building_id: "",
    joining_date: new Date().toISOString().slice(0, 10),
    monthly_salary: "",
  });

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [activeStaff, setActiveStaff] = useState<Staff | null>(null);
  const [payForm, setPayForm] = useState({
    salary_month: new Date().toISOString().slice(0, 7) + "-01",
    amount_paid: "",
    payment_date: new Date().toISOString().slice(0, 10),
  });

  function load() {
    api.get<Staff[]>("/staff").then(setStaff);
    api.get<SalaryPayment[]>("/salary_payments").then(setSalaryPayments);
  }

  useEffect(() => {
    load();
    api.get<Building[]>("/buildings").then(setBuildings);
  }, []);

  function openStaffModal() {
    setStaffError(null);
    setStaffForm({
      full_name: "",
      designation: "",
      phone: "",
      building_id: "",
      joining_date: new Date().toISOString().slice(0, 10),
      monthly_salary: "",
    });
    setStaffModalOpen(true);
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    setStaffSaving(true);
    setStaffError(null);
    try {
      await api.post("/staff", {
        full_name: staffForm.full_name,
        designation: staffForm.designation || undefined,
        phone: staffForm.phone || undefined,
        building_id: staffForm.building_id || undefined,
        joining_date: staffForm.joining_date || undefined,
        monthly_salary: parseFloat(staffForm.monthly_salary),
      });
      setStaffModalOpen(false);
      load();
    } catch (err: any) {
      setStaffError(err.message);
    } finally {
      setStaffSaving(false);
    }
  }

  function openPayModal(member: Staff) {
    setActiveStaff(member);
    setPayError(null);
    setPayForm({
      salary_month: new Date().toISOString().slice(0, 7) + "-01",
      amount_paid: String(member.monthly_salary),
      payment_date: new Date().toISOString().slice(0, 10),
    });
    setPayModalOpen(true);
  }

  async function handlePaySalary(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStaff) return;
    setPaySaving(true);
    setPayError(null);
    try {
      await api.post("/salary_payments", {
        staff_id: activeStaff.id,
        salary_month: payForm.salary_month,
        amount_paid: parseFloat(payForm.amount_paid),
        payment_date: payForm.payment_date,
      });
      setPayModalOpen(false);
      load();
    } catch (err: any) {
      setPayError(err.message);
    } finally {
      setPaySaving(false);
    }
  }

  const buildingName = (id?: string) => buildings?.find((b) => b.id === id)?.name ?? "All buildings";
  const paymentsFor = (staffId: string) =>
    (salaryPayments ?? []).filter((p) => p.staff_id === staffId).sort((a, b) => b.salary_month.localeCompare(a.salary_month));
  const isPaidThisMonth = (staffId: string) => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    return paymentsFor(staffId).some((p) => p.salary_month.startsWith(currentMonth));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Staff & salaries</h1>
          <p className="text-sm text-ink/55 mt-1">
            Your team, their monthly salary, and payment history — feeds directly into P&amp;L.
          </p>
        </div>
        <Button onClick={openStaffModal}>Add staff</Button>
      </div>

      <Card>
        <DataTable
          keyField="id"
          rows={staff ?? []}
          emptyMessage="No staff added yet."
          columns={[
            { header: "Name", accessor: (s) => <span className="font-medium">{s.full_name}</span> },
            { header: "Designation", accessor: (s) => s.designation ?? "—" },
            { header: "Assigned to", accessor: (s) => buildingName(s.building_id) },
            {
              header: "Monthly salary",
              accessor: (s) => <span className="figures">{formatPkr(s.monthly_salary)}</span>,
              align: "right",
            },
            { header: "Status", accessor: (s) => <StampBadge status={s.status} /> },
            {
              header: "This month",
              accessor: (s) =>
                isPaidThisMonth(s.id) ? (
                  <StampBadge status="paid" />
                ) : (
                  <span className="text-xs text-stamp-amber font-medium">Not paid yet</span>
                ),
            },
            {
              header: "",
              accessor: (s) => (
                <Button variant="secondary" onClick={() => openPayModal(s)}>
                  Pay salary
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      </Card>

      <Modal open={staffModalOpen} onClose={() => setStaffModalOpen(false)} title="Add staff">
        <form onSubmit={handleAddStaff} className="space-y-4">
          <Field label="Full name">
            <Input
              required
              value={staffForm.full_name}
              onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
            />
          </Field>
          <Field label="Designation">
            <Input
              placeholder="e.g. Guard, Plumber, Manager"
              value={staffForm.designation}
              onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={staffForm.phone}
              onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
            />
          </Field>
          <Field label="Assigned building (optional)" hint="Leave blank if they work across all buildings.">
            <Select
              value={staffForm.building_id}
              onChange={(e) => setStaffForm({ ...staffForm, building_id: e.target.value })}
            >
              <option value="">All buildings</option>
              {buildings?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Joining date">
            <Input
              type="date"
              value={staffForm.joining_date}
              onChange={(e) => setStaffForm({ ...staffForm, joining_date: e.target.value })}
            />
          </Field>
          <Field label="Monthly salary">
            <AmountInput
              required
              value={staffForm.monthly_salary}
              onChange={(e) => setStaffForm({ ...staffForm, monthly_salary: e.target.value })}
            />
          </Field>
          {staffError && <p className="text-sm text-stamp-red">{staffError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setStaffModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={staffSaving}>
              {staffSaving ? "Saving…" : "Add staff"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title={`Pay salary — ${activeStaff?.full_name ?? ""}`}
      >
        <form onSubmit={handlePaySalary} className="space-y-4">
          <Field label="Salary month">
            <Input
              type="month"
              required
              value={payForm.salary_month.slice(0, 7)}
              onChange={(e) => setPayForm({ ...payForm, salary_month: e.target.value + "-01" })}
            />
          </Field>
          <Field label="Amount paid">
            <AmountInput
              required
              value={payForm.amount_paid}
              onChange={(e) => setPayForm({ ...payForm, amount_paid: e.target.value })}
            />
          </Field>
          <Field label="Payment date">
            <Input
              type="date"
              required
              value={payForm.payment_date}
              onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
            />
          </Field>
          {payError && <p className="text-sm text-stamp-red">{payError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPayModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={paySaving}>
              {paySaving ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
