import { IconPhone, IconMail, IconVideo } from "@/components/ui/icons";

// Centralized here so a future number/email/link change is a one-line edit,
// not a find-and-replace across every auth page.
const WHATSAPP_DIGITS = "923716853677"; // 0371 6853677, normalized for wa.me
const CONTACT_EMAIL = "siqbalhwc@gmail.com";
const WEBSITE_URL = "https://www.oneaccountsbysiqbal.com";
const YOUTUBE_URL = "https://www.youtube.com/@OneAccountsbySiqbal";

/**
 * Real contact channels shown at the bottom of the login/signup card,
 * replacing a generic "Privacy / Terms / Support" row that didn't link
 * anywhere. Uses generic phone/video glyphs rather than the actual
 * WhatsApp/YouTube marks (trademarked logos), with the destination named
 * in the tooltip/aria-label instead.
 */
export function ContactFooter() {
  return (
    <div className="border-t border-border mt-2 pt-3 text-center">
      <a
        href={WEBSITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-ink/45 hover:text-ink/70 transition-colors"
      >
        oneaccountsbysiqbal.com
      </a>
      <div className="flex justify-center gap-5 mt-2">
        <a
          href={`https://wa.me/${WHATSAPP_DIGITS}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp: 0371 6853677"
          title="WhatsApp: 0371 6853677"
          className="text-ink/40 hover:text-ledger transition-colors"
        >
          <IconPhone size={16} />
        </a>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          aria-label={`Email ${CONTACT_EMAIL}`}
          title={CONTACT_EMAIL}
          className="text-ink/40 hover:text-ledger transition-colors"
        >
          <IconMail size={16} />
        </a>
        <a
          href={YOUTUBE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="OneAccounts by Siqbal on YouTube"
          title="OneAccounts by Siqbal — YouTube"
          className="text-ink/40 hover:text-ledger transition-colors"
        >
          <IconVideo size={16} />
        </a>
      </div>
    </div>
  );
}
