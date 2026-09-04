"use client";

import { useEffect } from "react";

// Root-level error boundary. Next.js App Router only shows a friendly
// screen for a render-time crash if a segment has an error.tsx -- without
// one, the person just sees a blank white page with nothing in it, and the
// only trace of what happened is a console error they'll never see. This
// covers any route that doesn't have a more specific error.tsx of its own.
export default function GlobalError({
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
    <html lang="en">
      <body>
        <div className="min-h-screen flex items-center justify-center bg-[#F3F1E6] px-4">
          <div className="max-w-md text-center space-y-4 bg-[#FBFAF5] border border-[#DCD7C4] rounded-lg shadow-sm p-8">
            <h2 className="text-lg font-semibold text-[#1F2D24]">Something went wrong</h2>
            <p className="text-sm text-[#1F2D24]/60">
              This page hit an unexpected error. It's been logged — try again, or head back to the dashboard.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={reset}
                className="text-sm px-4 py-2 rounded-md bg-[#2F4F3D] text-white hover:bg-[#22392C] transition-colors"
              >
                Try again
              </button>
              <a
                href="/"
                className="text-sm px-4 py-2 rounded-md border border-[#DCD7C4] hover:bg-[#F3F1E6] transition-colors"
              >
                Go to dashboard
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
