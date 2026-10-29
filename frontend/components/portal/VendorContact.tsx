import { CONTACT_EMAIL, WEBSITE_URL, WHATSAPP_DIGITS, WHATSAPP_DISPLAY } from "@/components/marketing/ContactFooter";

/** Shown under the tenant sign-in box: tenants who run their own business can get in touch about the
 *  software. The contact details live in ONE place (ContactFooter), so they're edited once. */
export function VendorContact() {
  return (
    <div className="w-full max-w-md mt-6 text-center">
      <p className="text-sm font-medium text-ink">Need a system like this for your own business?</p>
      <p className="text-xs text-ink/55 mt-1">OneAccounts by Siqbal builds accounting and property management software. Get in touch:</p>
      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-sm">
        <a className="text-accent hover:underline" href={`https://wa.me/${WHATSAPP_DIGITS}`} target="_blank" rel="noopener noreferrer">WhatsApp {WHATSAPP_DISPLAY}</a>
        <a className="text-accent hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <a className="text-accent hover:underline" href={WEBSITE_URL} target="_blank" rel="noopener noreferrer">oneaccountsbysiqbal.com</a>
      </div>
    </div>
  );
}
