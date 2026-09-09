/**
 * Shared shell for every auth page (login/signup/forgot/reset). Replaces
 * the old `min-h-screen flex bg-paper` pattern, which gave BrandPanel its
 * own `bg-ledger` fill against the page's `bg-paper` -- two different
 * background colors meeting edge-to-edge read as a hard seam down the
 * screen, especially in the Navy/Black themes where the two colors sit
 * close together anyway.
 *
 * This version puts both columns on the SAME background and centers them
 * together inside one max-width row with real spacing between them, so
 * they read as floating in one shared space rather than two rooms
 * divided by a wall. The soft radial glow behind everything is shared too
 * -- one ambient light source, not a panel-specific texture that stops
 * abruptly at a boundary.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 560px at 12% -8%, rgb(var(--ledger-light) / 0.14), transparent 60%), " +
            "radial-gradient(700px 480px at 92% 108%, rgb(var(--brass) / 0.07), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-[1180px] flex-col items-center justify-center gap-10 px-6 py-14 lg:flex-row lg:items-center lg:gap-20 lg:px-10">
        {children}
      </div>
    </div>
  );
}
