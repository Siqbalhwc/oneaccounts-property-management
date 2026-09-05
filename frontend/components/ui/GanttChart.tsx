"use client";

export type GanttStage = {
  id: string;
  display_name: string;
  sort_order: number;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  budget_amount: number;
  actual_amount: number;
  status: "not_started" | "in_progress" | "completed" | "blocked";
};

function toDate(s: string | null): Date | null {
  return s ? new Date(s + "T00:00:00") : null;
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function formatShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function formatPkr(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK")}`;
}

/**
 * Renders 5 stage rows on a shared timeline: a dashed outline bar for the
 * planned window, and a solid bar underneath for the actual window (colored
 * by status, and flagged brass/gold if it ran over its own budget). Falls
 * back gracefully if a stage has no dates yet (renders a "not scheduled"
 * placeholder row instead of dividing by zero).
 */
export function GanttChart({ stages }: { stages: GanttStage[] }) {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  const allPlannedDates = sorted
    .flatMap((s) => [toDate(s.planned_start), toDate(s.planned_end)])
    .filter((d): d is Date => d !== null);

  if (allPlannedDates.length === 0) {
    return (
      <div className="text-sm text-ink/45 py-8 text-center border border-dashed border-border rounded-card">
        No planned dates set yet for this engagement — add them on each stage to see the timeline.
      </div>
    );
  }

  const rangeStart = new Date(Math.min(...allPlannedDates.map((d) => d.getTime())));
  const rangeEnd = new Date(Math.max(...allPlannedDates.map((d) => d.getTime())));
  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));

  function pct(d: Date | null): number | null {
    if (!d) return null;
    return Math.min(100, Math.max(0, (daysBetween(rangeStart, d) / totalDays) * 100));
  }

  const statusColor: Record<GanttStage["status"], string> = {
    completed: "bg-accent",
    in_progress: "bg-brass",
    blocked: "bg-stamp-red",
    not_started: "",
  };

  const markers = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const d = new Date(rangeStart.getTime() + f * totalDays * 86400000);
    return formatShort(d);
  });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="flex text-[10.5px] font-mono text-ink/40 pl-[180px] mb-1.5">
          {markers.map((m, i) => (
            <span key={i} className="flex-1 border-l border-border pl-1.5">
              {m}
            </span>
          ))}
        </div>

        {sorted.map((s) => {
          const pStart = pct(toDate(s.planned_start));
          const pEnd = pct(toDate(s.planned_end));
          const aStart = pct(toDate(s.actual_start));
          const aEnd = pct(toDate(s.actual_end)) ?? (s.status === "in_progress" ? pct(new Date())! : null);
          const overBudget = s.actual_amount > 0 && s.budget_amount > 0 && s.actual_amount > s.budget_amount;

          return (
            <div key={s.id} className="flex items-center mb-2.5">
              <div className="w-[180px] shrink-0 pr-3.5">
                <p className="text-[13px] font-medium">
                  {s.sort_order} · {s.display_name}
                </p>
                <p className={`text-[11px] mt-0.5 ${overBudget ? "text-stamp-red font-medium" : "text-ink/40"}`}>
                  {formatPkr(s.budget_amount)}
                  {s.actual_amount > 0 && <> → {formatPkr(s.actual_amount)}</>}
                </p>
              </div>
              <div className="relative flex-1 h-[34px] rounded-md bg-[repeating-linear-gradient(90deg,transparent,transparent_9%,var(--tw-border-opacity,1)_9%)] border border-border/40">
                {pStart !== null && pEnd !== null && (
                  <div
                    className="absolute h-[9px] rounded-[5px] border-[1.5px] border-dashed border-brass-dark"
                    style={{ top: "8px", left: `${pStart}%`, width: `${Math.max(2, pEnd - pStart)}%` }}
                  />
                )}
                {aStart !== null && aEnd !== null && (
                  <div
                    className={`absolute h-[9px] rounded-[5px] ${overBudget ? "bg-brass-dark" : statusColor[s.status] || "bg-ink/20"}`}
                    style={{ top: "19px", left: `${aStart}%`, width: `${Math.max(2, aEnd - aStart)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}

        <div className="flex gap-5 mt-3.5 text-[11.5px] text-ink/55">
          <span>
            <span className="inline-block w-3.5 h-[9px] rounded mr-1.5 align-middle border-[1.5px] border-dashed border-brass-dark" />
            Planned
          </span>
          <span>
            <span className="inline-block w-3.5 h-[9px] rounded mr-1.5 align-middle bg-accent" />
            Actual — completed
          </span>
          <span>
            <span className="inline-block w-3.5 h-[9px] rounded mr-1.5 align-middle bg-brass" />
            In progress
          </span>
          <span>
            <span className="inline-block w-3.5 h-[9px] rounded mr-1.5 align-middle bg-brass-dark" />
            Over budget / late
          </span>
        </div>
      </div>
    </div>
  );
}
