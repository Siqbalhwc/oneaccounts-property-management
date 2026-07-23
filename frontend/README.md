# Ledger — Property Management Frontend (Next.js)

## Design system
Built on a "ledger book" identity, not a generic dashboard template:
- **Colors**: bottle-green ink (#1F2D24), ledger-green (#2F4F3D), brass accent
  (#C89B5C), cool paper background (#F3F1E6), stamp-red for alerts (#A63D40).
- **Type**: Fraunces (display), IBM Plex Sans (body/UI), IBM Plex Mono
  (anything numeric — amounts, CNIC, invoice numbers) so figures line up.
- **Signature element**: the `StampBadge` component — status badges styled
  like a rotated ink stamp, echoing the real "PAID" rubber stamp on a rent
  receipt.

## Local run
1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in your Supabase project
   URL/anon key, plus the URL where your FastAPI backend is running.
3. `npm run dev` → http://localhost:3000

## Structure
- `app/(dashboard)/` — all authenticated pages, wrapped in the sidebar layout
- `app/login/` — sign-in page
- `components/ui/` — the shared design system (Button, Field/Input, Card,
  DataTable, StampBadge, Sidebar)
- `lib/api.ts` — typed fetch wrapper that attaches the Supabase session token
  to every backend request
- `lib/supabaseClient.ts` — Supabase browser client for auth

## Pages included
Dashboard (KPIs + dues), Buildings & rooms, Tenants, Leases (list + multi-step
create form), Invoices, Expenses, Owner ledger, Reports (P&L).

## Not yet wired up (by design, left for the next pass)
- Route protection / redirect-to-login middleware
- Building/tenant/expense "create" modals (forms exist for leases; others are
  list views ready to have a modal or drawer added the same way)
- WhatsApp send button on invoices (backend has `mark-sent`, ready for it)
