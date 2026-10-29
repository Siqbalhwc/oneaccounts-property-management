"use client";

import { useId, useState } from "react";

/**
 * A settings-style section that is FOLDED by default: only a one-line row (title, optional hint,
 * optional action button) is visible until the person clicks it. The content stays mounted while
 * folded, so anything half-typed in a form is not lost if they fold and unfold it.
 */
export function CollapsibleCard({
  title,
  hint,
  action,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="card">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className={`shrink-0 text-ink/45 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M6 3l5 5-5 5" />
          </svg>
          <span className="min-w-0">
            <span className="block font-display text-base font-semibold">{title}</span>
            {hint && !open && <span className="block text-xs text-ink/50 truncate">{hint}</span>}
          </span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div id={panelId} hidden={!open} className="px-4 sm:px-5 pb-5 pt-1 border-t border-border/60">
        <div className="pt-4">{children}</div>
      </div>
    </div>
  );
}
