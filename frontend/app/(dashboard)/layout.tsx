"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Sidebar } from "@/components/ui/Sidebar";
import { Company } from "@/lib/api";

type ProfileInfo = { full_name: string; role: string; company_id: string; is_platform_admin?: boolean };

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [checking, setChecking] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    async function checkSessionAndLoadProfile() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, role, company_id, is_platform_admin")
        .eq("id", session.user.id)
        .single();

      if (profileRow) {
        setProfile(profileRow as ProfileInfo);
        const { data: companyRow } = await supabase
          .from("companies")
          .select("id, name, address, phone, logo_url")
          .eq("id", (profileRow as ProfileInfo).company_id)
          .single();
        if (companyRow) setCompany(companyRow as Company);
      }
      setChecking(false);
    }

    checkSessionAndLoadProfile();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });
    return () => listener.subscription.unsubscribe();
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <p className="text-sm text-ink/50">Checking your session…</p>
      </div>
    );
  }

  const initials = profile
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";
  const firstName = profile?.full_name?.split(" ")[0] ?? "";

  return (
    <div className="flex min-h-screen">
      <Sidebar
        company={company}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        isPlatformAdmin={!!profile?.is_platform_admin}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print h-16 border-b border-border bg-paper-card flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden text-ink/60 hover:text-ink shrink-0"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <p className="text-sm text-ink/60 truncate hidden sm:block">
              {greeting()}{firstName ? `, ${firstName}` : ""}.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">
                {profile?.full_name ?? "Unknown user"}
              </p>
              <p className="text-xs text-ink/50 leading-tight capitalize">
                {profile?.role ?? "—"}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-brass/20 border border-brass/40 flex items-center justify-center text-xs font-display font-semibold text-brass-dark shrink-0">
              {initials}
            </div>
            <button
              onClick={handleSignOut}
              className="text-xs text-ink/50 hover:text-stamp-red transition-colors ml-1 whitespace-nowrap"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="content flex-1 px-4 sm:px-6 py-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
