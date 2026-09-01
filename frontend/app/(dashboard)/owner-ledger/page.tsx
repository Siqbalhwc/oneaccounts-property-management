"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// "Owner ledger" used to be a second, separate page from "Owners" -- same
// job, two menu items, and this one read balances from an old owner_ledger
// snapshot table that nothing recomputes automatically anymore, so it could
// disagree with what's actually posted in the real ledger. Consolidated:
// Owners (under Property) is now the only place for this, and its "Pay"
// button/balance reads the live Due to Owners account directly. This page
// stays only so any old bookmark/link still lands somewhere sensible.
export default function OwnerLedgerRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/owners");
  }, [router]);
  return null;
}
