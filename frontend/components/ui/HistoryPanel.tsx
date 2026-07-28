"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type AuditEntry = {
  id: string;
  action: string;
  details: Record<string, { from: any; to: any }> | null;
  created_at: string;
  profiles: { full_name: string } | null;
};

function formatValue(v: any) {
  if (v === null || v === undefined || v === "") return "(empty)";
  return String(v);
}

export function HistoryPanel({ tableName, recordId }: { tableName: string; recordId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    api
      .get<AuditEntry[]>(`/audit-log?table_name=${tableName}&record_id=${recordId}`)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [tableName, recordId]);

  if (!entries) {
    return <p className="text-xs text-ink/40">Loading history…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-xs text-ink/40">No changes recorded yet.</p>;
  }

  return (
    <div className="space-y-2.5 max-h-48 overflow-y-auto">
      {entries.map((entry) => (
        <div key={entry.id} className="text-xs border-l-2 border-border pl-3">
          <p className="text-ink/60">
            <span className="font-medium capitalize">{entry.action}</span>
            {" by "}
            {entry.profiles?.full_name ?? "someone"}
            {" — "}
            {new Date(entry.created_at).toLocaleString("en-US", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          {entry.details && (
            <ul className="mt-1 space-y-0.5">
              {Object.entries(entry.details).map(([field, change]) => (
                <li key={field} className="text-ink/45">
                  <span className="capitalize">{field.replace(/_/g, " ")}</span>: &quot;
                  {formatValue(change.from)}&quot; → &quot;{formatValue(change.to)}&quot;
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
