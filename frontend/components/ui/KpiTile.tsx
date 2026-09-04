import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";
import { IconArrowUpRight } from "@/components/ui/LedgerIcons";

export function KpiTile({
  href,
  icon,
  iconClassName,
  label,
  value,
  loading,
  deltaText,
  deltaTone,
}: {
  href: string;
  icon: React.ReactNode;
  iconClassName: string;
  label: string;
  value: string;
  loading: boolean;
  deltaText?: string | null;
  deltaTone?: "up" | "down" | "neutral";
}) {
  return (
    <Link
      href={href}
      className="group relative block card p-5 pl-[18px] border-l-[3px] border-l-transparent hover:border-l-brass focus-visible:border-l-brass transition-colors"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconClassName}`}>
          {icon}
        </div>
        <p className="text-xs uppercase tracking-wider text-ink/50 font-medium">{label}</p>
      </div>

      {loading ? (
        <Skeleton className="h-7 w-2/3" />
      ) : (
        <p className="text-2xl font-display font-semibold figures">{value}</p>
      )}

      {!loading && deltaText && (
        <p
          className={`text-xs mt-1 ${
            deltaTone === "up" ? "text-stamp-green" : deltaTone === "down" ? "text-stamp-red" : "text-ink/40"
          }`}
        >
          {deltaText}
        </p>
      )}

      <span className="absolute top-4 right-4 w-5 h-5 rounded-full flex items-center justify-center text-ledger opacity-0 -translate-x-0.5 translate-y-0.5 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:translate-y-0 transition-all">
        <IconArrowUpRight size={13} />
      </span>
    </Link>
  );
}
