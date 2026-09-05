import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BLOCKING_SCRIPT } from "@/lib/theme";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "OneAccounts | Properties Management",
  description: "Simple by design. Professional by nature. Buildings, tenants, rent, and ledgers in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <head>
        {/* Runs before hydration so a saved Black/Navy preference applies
            immediately, instead of flashing the default Ledger theme for a
            moment on every page load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BLOCKING_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
