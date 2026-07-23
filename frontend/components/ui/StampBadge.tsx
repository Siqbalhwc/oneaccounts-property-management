const STATUS_MAP: Record<string, { label: string; className: string }> = {
  paid: { label: "Paid", className: "stamp-paid" },
  sent: { label: "Sent", className: "stamp-pending" },
  draft: { label: "Draft", className: "stamp-pending" },
  partial: { label: "Partial", className: "stamp-pending" },
  overdue: { label: "Overdue", className: "stamp-overdue" },
  cancelled: { label: "Cancelled", className: "stamp-terminated" },
  active: { label: "Active", className: "stamp-active" },
  terminated: { label: "Terminated", className: "stamp-terminated" },
  expired: { label: "Expired", className: "stamp-terminated" },
  vacant: { label: "Vacant", className: "stamp-pending" },
  occupied: { label: "Occupied", className: "stamp-active" },
  under_maintenance: { label: "Under repair", className: "stamp-overdue" },
  reserved: { label: "Reserved", className: "stamp-pending" },
  held: { label: "Held", className: "stamp-held" },
  refunded: { label: "Refunded", className: "stamp-refunded" },
  partially_refunded: { label: "Partial refund", className: "stamp-held" },
};

export function StampBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? { label: status, className: "stamp-pending" };
  return <span className={`stamp ${entry.className}`}>{entry.label}</span>;
}
