"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="card p-8 max-w-lg mx-auto mt-10 text-center space-y-4">
      <h2 className="font-display text-lg font-semibold text-stamp-red">This page hit a snag</h2>
      <p className="text-sm text-ink/60">
        Something didn't load correctly. It's been logged — try again, and if it keeps happening, let us know
        what you were doing right before this.
      </p>
      <div className="flex items-center justify-center gap-3 pt-2">
        <button
          onClick={reset}
          className="text-sm px-4 py-2 rounded-card bg-ledger text-sidebar-ink hover:bg-ledger-dark transition-colors"
        >
          Try again
        </button>
        <a
          href="/"
          className="text-sm px-4 py-2 rounded-card border border-border hover:bg-paper transition-colors"
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
