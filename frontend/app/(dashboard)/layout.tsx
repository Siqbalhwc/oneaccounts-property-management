"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Sidebar } from "@/components/ui/Sidebar";
import { GlobalSearch } from "@/components/ui/GlobalSearch";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Company } from "@/lib/api";

type ProfileInfo = {
  full_name: string;
  role: string;
  company_id: string;
  is_platform_admin?: boolean;
  is_suspended?: boolean;
};

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
  const [companyBlocked, setCompanyBlocked] = useState(false);

  useEffect(() => {
    async function checkSessionAndLoadProfile() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session) {
        router.replace("/login");
        return;
      }

      // Combined into ONE query via PostgREST's embedded-resource syntax
      // (profiles.company_id -> companies.id) instead of two sequential
      // round trips (fetch profile, THEN fetch company). This is purely a
      // network-shape change -- RLS still applies independently to both
      // `profiles` and `companies` exactly as before, so a user still only
      // ever sees their own profile and their own company's row. If RLS
      // blocks the embedded companies row (company suspended), PostgREST
      // simply returns `companies: null` here, which is the same signal
      // the old two-query version relied on -- the detection logic below
      // is unchanged.
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, role, company_id, is_platform_admin, is_suspended, companies(id, name, address, phone, logo_url)")
        .eq("id", session.user.id)
        .single();

      if (profileRow) {
        const raw = profileRow as unknown as ProfileInfo & { companies: Company | Company[] | null };
        const { companies: companiesRaw, ...profileFields } = raw;
        // Supabase's TS types this embed as an array regardless of
        // cardinality, but a to-one FK relationship (profiles.company_id ->
        // companies.id) actually returns a single object (or null) at
        // runtime. Normalize defensively so this works correctly either way.
        const companyRow: Company | null = Array.isArray(companiesRaw)
          ? companiesRaw[0] ?? null
          : companiesRaw;
        setProfile(profileFields);
        if (companyRow) {
          setCompany(companyRow);
        } else if (!(profileFields as ProfileInfo).is_suspended) {
          // Profile loaded fine (so the user isn't individually suspended),
          // but the company row itself is unreadable -- Row Level Security
          // blocks it once a platform admin suspends the whole company.
          // This is the ONLY signal the frontend has for that case (RLS
          // fails closed with no error detail, by design), so we treat a
          // missing company row as "company suspended".
          setCompanyBlocked(true);
        }
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

  if (profile?.is_suspended || companyBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="card p-8 max-w-md text-center space-y-3">
          <h2 className="font-display text-lg font-semibold text-stamp-red">Access suspended</h2>
          <p className="text-sm text-ink/60">
            {profile?.is_suspended
              ? "Your account has been suspended. Contact your company owner for help."
              : "Your company's access has been suspended. Contact support for help."}
          </p>
          <button
            onClick={handleSignOut}
            className="text-xs text-ink/50 hover:text-stamp-red transition-colors"
          >
            Sign out
          </button>
        </div>
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
    <div className="flex items-start gap-4 p-4 min-h-screen">
      <Sidebar
        company={company}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        isPlatformAdmin={!!profile?.is_platform_admin}
        showImplementation={
          !!profile?.is_platform_admin ||
          profile?.role === "client_requester" ||
          profile?.role === "client_senior_approver"
        }
      />
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <header className="no-print bg-paper-card border border-border rounded-shell shadow-shell flex items-center gap-4 px-4 sm:px-5 py-3 shrink-0">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden text-ink/60 hover:text-ink shrink-0"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <p className="text-sm text-ink/60 truncate hidden sm:block shrink-0">
            {greeting()}{firstName ? `, ${firstName}` : ""}.
          </p>

          <div className="hidden md:block flex-1">
            <GlobalSearch />
          </div>

          <div className="flex items-center gap-3 ml-auto shrink-0">
            <NotificationBell />
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
        <main className="content flex-1 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
