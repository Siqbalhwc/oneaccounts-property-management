import { Company } from "@/lib/api";

/**
 * Shown only in print output (hidden on screen) so printed reports carry the
 * same branding as the invoice PDF -- logo, company name, and a tagline --
 * instead of starting cold with just a table.
 */
export function PrintHeader({ company, reportTitle }: { company: Company | null; reportTitle: string }) {
  if (!company) return null;
  return (
    <div className="hidden print:flex items-center gap-3 pb-4 mb-4 border-b-4 border-ledger">
      {company.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logo_url} alt={company.name} className="w-14 h-14 object-contain" />
      )}
      <div>
        <p className="font-display text-xl font-semibold text-ledger">{company.name}</p>
        <p className="text-xs text-ink/50">Property Management — {reportTitle}</p>
      </div>
    </div>
  );
}
