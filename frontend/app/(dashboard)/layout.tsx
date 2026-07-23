import { Sidebar } from "@/components/ui/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-paper-card flex items-center justify-between px-6 shrink-0">
          <div />
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">Aliya Khan</p>
              <p className="text-xs text-ink/50 leading-tight">Admin</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-brass/20 border border-brass/40 flex items-center justify-center text-xs font-display font-semibold text-brass-dark">
              AK
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
