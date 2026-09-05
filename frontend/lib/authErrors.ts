/**
 * Supabase Auth returns technical, SDK-level error strings (e.g. "Invalid
 * login credentials"). This maps known ones to plain, friendly copy for
 * the login/signup/reset-password screens. Anything unrecognized falls
 * back to the original message rather than hiding it -- we never want to
 * swallow a real error the person needs to see, just soften the ones we
 * already know about.
 */
const KNOWN_MESSAGES: Record<string, string> = {
  "invalid login credentials": "That email or password doesn't look right. Try again.",
  "email not confirmed": "Please confirm your email address before signing in.",
  "user already registered": "An account with this email already exists — try signing in instead.",
  "password should be at least 6 characters": "Choose a password with at least 6 characters.",
  "for security purposes, you can only request this after":
    "Please wait a minute before requesting another link.",
};

export function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  for (const key of Object.keys(KNOWN_MESSAGES)) {
    if (lower.includes(key)) return KNOWN_MESSAGES[key];
  }
  return message;
}
