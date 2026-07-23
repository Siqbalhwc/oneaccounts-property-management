export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="font-display text-base font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-ink/50 font-medium mb-2">
        {label}
      </p>
      <p className="text-2xl font-display font-semibold figures">{value}</p>
      {sublabel && <p className="text-xs text-ink/50 mt-1">{sublabel}</p>}
    </div>
  );
}

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  keyField,
  emptyMessage = "Nothing here yet.",
  onRowClick,
}: {
  columns: { header: string; accessor: (row: T) => React.ReactNode; align?: "left" | "right" }[];
  rows: T[];
  keyField: keyof T;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-ink/45 border border-dashed border-border rounded-card">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.header}
                className={`text-xs uppercase tracking-wider text-ink/50 font-medium pb-2.5 pr-4 ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={String(row[keyField])}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-border/60 last:border-0 ${
                onRowClick ? "cursor-pointer hover:bg-ledger/[0.03]" : ""
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={`py-3 pr-4 ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  {col.accessor(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
