from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_supabase
from app.services.ledger import get_account_id, post_journal_entry, reverse_journal_entry
from app.services.owner_settlement import EPS, load_owner_settlement

router = APIRouter(prefix="/owner-ledger", tags=["Owner Ledger"])


class ComputeRequest(BaseModel):
    building_id: str
    month: date  # any date within the target month


class PayRequest(BaseModel):
    amount_paid: float
    paid_date: Optional[date] = None


@router.get("")
def list_ledger(supabase: Client = Depends(get_supabase)):
    return supabase.table("owner_ledger").select("*").order("ledger_month", desc=True).execute().data


@router.get("/balances")
def owner_balances(
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Real-time amount owed to each owner, read straight from every account
    flagged transfers_to_owner=true (Due to Owners / 2200 is always one of
    these, but a company can map additional owner-chargeable categories --
    e.g. "Owner Chargeable Repairs" -- to that same or another such
    account). This is the SAME set of journal_lines the "View ledger" page
    (/ledger?account_id=...&owner_id=...) already shows for each account,
    so rent collected (a credit) and any expense charged to that owner (a
    debit) both land in one number here -- nothing extra to reconcile.

    This is deliberately NOT the old owner_ledger table below (used by
    list_ledger/compute/pay above) -- that table is a one-time-computed
    snapshot nothing in the current app recomputes automatically anymore,
    so it silently drifts out of sync with what's actually posted. This
    endpoint can never disagree with the ledger, because it's reading the
    exact same rows.
    """
    owner_accounts = (
        supabase.table("chart_of_accounts")
        .select("id")
        .eq("company_id", company_id)
        .eq("transfers_to_owner", True)
        .execute()
        .data
    )
    account_ids = [a["id"] for a in owner_accounts]
    if not account_ids:
        return []

    lines = (
        supabase.table("journal_lines")
        .select("owner_id, direction, amount")
        .in_("account_id", account_ids)
        .not_.is_("owner_id", "null")
        .execute()
        .data
    )
    balances: dict[str, float] = {}
    for l in lines:
        oid = l["owner_id"]
        # Credit increases what's owed (e.g. rent); debit reduces it (e.g.
        # an expense charged to them, or a payout).
        delta = float(l["amount"]) if l["direction"] == "credit" else -float(l["amount"])
        balances[oid] = balances.get(oid, 0.0) + delta
    return [
        {"owner_id": oid, "balance": round(bal, 2)}
        for oid, bal in balances.items()
        if round(bal, 2) != 0
    ]


@router.get("/breakdown/{owner_id}")
def owner_balance_breakdown(
    owner_id: str,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Every journal line behind an owner's current balance -- rent credits and
    any owner-chargeable expense debits together, oldest first -- plus a
    running balance. This is what the new full-page payout screen shows so
    a payout is never made blind to what it's actually covering. Reads the
    same transfers_to_owner accounts /balances does, just per-owner and
    with the underlying lines instead of a single total.
    """
    owner_accounts = (
        supabase.table("chart_of_accounts")
        .select("id, code, name")
        .eq("company_id", company_id)
        .eq("transfers_to_owner", True)
        .execute()
        .data
    )
    account_ids = [a["id"] for a in owner_accounts]
    account_by_id = {a["id"]: a for a in owner_accounts}
    if not account_ids:
        return {"lines": [], "balance": 0.0}

    lines = (
        supabase.table("journal_lines")
        .select("journal_entry_id, account_id, direction, amount, building_id, room_id")
        .in_("account_id", account_ids)
        .eq("owner_id", owner_id)
        .execute()
        .data
    )
    if not lines:
        return {"lines": [], "balance": 0.0}

    entry_ids = list({l["journal_entry_id"] for l in lines})
    entries = (
        supabase.table("journal_entries")
        .select("id, entry_date, description, source_type")
        .in_("id", entry_ids)
        .execute()
        .data
    )
    entry_by_id = {e["id"]: e for e in entries}

    building_ids = list({l["building_id"] for l in lines if l.get("building_id")})
    buildings = (
        supabase.table("buildings").select("id, name").in_("id", building_ids).execute().data
        if building_ids else []
    )
    building_name_by_id = {b["id"]: b["name"] for b in buildings}

    room_ids = list({l["room_id"] for l in lines if l.get("room_id")})
    rooms = (
        supabase.table("rooms").select("id, room_number").in_("id", room_ids).execute().data
        if room_ids else []
    )
    room_number_by_id = {r["id"]: r["room_number"] for r in rooms}

    rows = []
    for l in lines:
        entry = entry_by_id.get(l["journal_entry_id"], {})
        rows.append(
            {
                "entry_date": entry.get("entry_date"),
                "description": entry.get("description"),
                "source_type": entry.get("source_type"),
                "account_name": (account_by_id.get(l["account_id"]) or {}).get("name"),
                "direction": l["direction"],
                "amount": float(l["amount"]),
                "building_name": building_name_by_id.get(l.get("building_id")),
                "room_number": room_number_by_id.get(l.get("room_id")),
            }
        )
    rows.sort(key=lambda r: r["entry_date"] or "")

    running = 0.0
    for r in rows:
        running += r["amount"] if r["direction"] == "credit" else -r["amount"]
        r["running_balance"] = round(running, 2)

    return {"lines": rows, "balance": round(running, 2)}


# ---------------------------------------------------------------------------
# Per-room / per-invoice settlement (see app/services/owner_settlement.py)
# ---------------------------------------------------------------------------
@router.get("/settlement/{owner_id}")
def owner_settlement(
    owner_id: str,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Everything the payout screen needs for one owner: every rent invoice line
    (per room, per month) with how much has already been paid to the owner
    and how much is still open; every expense charged to the owner that can
    be netted off a payout; and a per-room rollup marking each room payable
    or settled. Totals reconcile to the owner's General Ledger balance.
    """
    return load_owner_settlement(supabase, company_id, owner_id)


class PayoutSelection(BaseModel):
    line_id: str
    amount: float  # how much of this line to settle now (partial allowed)


class AllocatedPayoutRequest(BaseModel):
    owner_id: str
    selections: List[PayoutSelection]
    paid_date: Optional[date] = None
    account_id: Optional[str] = None  # required when the net payout is > 0
    payment_method: str = "bank_transfer"
    notes: Optional[str] = None


@router.post("/pay-owner-allocated")
def pay_owner_allocated(
    payload: AllocatedPayoutRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Pays an owner against specific lines: rent invoice lines (in full or
    part) and, optionally, expenses to net off. Cash paid out =
    rent settled - expenses netted. One Dr Due to Owners / Cr <paid from>
    entry is posted for that net amount, and each settled line is recorded
    in owner_payout_allocations so the system knows exactly which room /
    invoice was paid.
    """
    if not payload.selections:
        raise HTTPException(status_code=400, detail="Select at least one invoice or expense.")

    view = load_owner_settlement(supabase, company_id, payload.owner_id)
    unit_by_line = {u["line_id"]: u for u in view["units"]}

    rent_total = exp_total = 0.0
    seen: set[str] = set()
    picked: list[tuple[dict, float]] = []
    for sel in payload.selections:
        if sel.line_id in seen:
            raise HTTPException(status_code=400, detail="The same line was selected twice.")
        seen.add(sel.line_id)
        unit = unit_by_line.get(sel.line_id)
        if not unit:
            raise HTTPException(status_code=400, detail="A selected line no longer belongs to this owner. Refresh and try again.")
        amt = round(float(sel.amount), 2)
        if amt <= 0:
            raise HTTPException(status_code=400, detail="Every selected amount must be greater than zero.")
        if amt > unit["remaining"] + EPS:
            label = f"{unit.get('building_name') or ''} {unit.get('room_number') or ''}".strip()
            raise HTTPException(
                status_code=400,
                detail=f"{label or 'A line'} has only Rs {unit['remaining']:,.2f} left to settle — you entered Rs {amt:,.2f}.",
            )
        picked.append((unit, amt))
        if unit["kind"] == "expense":
            exp_total += amt
        else:
            rent_total += amt

    net = round(rent_total - exp_total, 2)
    if net < 0:
        raise HTTPException(
            status_code=400,
            detail="Selected expenses are more than the selected rent — select more rent, or fewer expenses.",
        )

    paid_date = payload.paid_date or date.today()
    entry = None
    if net > 0:
        if not payload.account_id:
            raise HTTPException(status_code=400, detail="Select which account this payout is coming out of.")
        account = (
            supabase.table("chart_of_accounts").select("id")
            .eq("id", payload.account_id).eq("company_id", company_id).execute().data
        )
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")

        building_ids = {u["building_id"] for u, _ in picked if u.get("building_id")}
        building_id = next(iter(building_ids)) if len(building_ids) == 1 else None
        due_to_owners_id = get_account_id(supabase, company_id, "2200")
        rooms_label = ", ".join(
            sorted({f"{u.get('room_number')}" for u, _ in picked if u["kind"] != "expense" and u.get("room_number")})
        )
        default_desc = f"Owner payout — {paid_date}" + (f" (rooms {rooms_label})" if rooms_label else "")
        entry = post_journal_entry(
            supabase,
            company_id=company_id,
            entry_date=str(paid_date),
            source_type="owner_payout",
            source_id=None,
            description=payload.notes or default_desc,
            lines=[
                {"account_id": due_to_owners_id, "direction": "debit", "amount": net,
                 "building_id": building_id, "owner_id": payload.owner_id},
                {"account_id": payload.account_id, "direction": "credit", "amount": net,
                 "building_id": building_id, "owner_id": payload.owner_id},
            ],
        )

    rows = [
        {
            "company_id": company_id,
            "owner_id": payload.owner_id,
            "payout_entry_id": entry["id"] if entry else None,
            "source_line_id": u["line_id"],
            "kind": u["kind"],
            "invoice_id": u.get("invoice_id"),
            "room_id": u.get("room_id"),
            "building_id": u.get("building_id"),
            "amount": amt,
            "paid_date": str(paid_date),
        }
        for u, amt in picked
    ]
    try:
        supabase.table("owner_payout_allocations").insert(rows).execute()
    except Exception as e:
        # Not a single DB transaction: undo the cash entry so the ledger and
        # the per-room tracking can never disagree.
        if entry:
            reverse_journal_entry(supabase, company_id, entry["id"], "Allocation tracking failed")
        raise HTTPException(status_code=400, detail=f"Could not record the payout: {e}")

    return {
        "message": "Payout recorded",
        "owner_id": payload.owner_id,
        "rent_settled": round(rent_total, 2),
        "expenses_netted": round(exp_total, 2),
        "net_paid": net,
        "lines": len(rows),
    }


@router.post("/apply-earlier-payouts/{owner_id}")
def apply_earlier_payouts(
    owner_id: str,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    One-time back-fill for payouts made before per-room tracking existed:
    matches each earlier lump-sum payout to this owner's oldest open rent
    lines (oldest first) so room statuses reflect money already paid. Only
    touches tracking rows -- posts no journal entry, so the ledger balance
    doesn't change.
    """
    view = load_owner_settlement(supabase, company_id, owner_id)
    open_units = [u for u in view["units"] if u["kind"] != "expense" and u["remaining"] > EPS]
    rows = []
    for pe in sorted(
        (p for p in view["unapplied_entries"] if p["source_type"] == "owner_payout"),
        key=lambda p: p["entry_date"] or "",
    ):
        left = pe["uncovered"]
        for u in open_units:
            if left <= EPS:
                break
            take = round(min(left, u["remaining"]), 2)
            if take <= 0:
                continue
            rows.append(
                {
                    "company_id": company_id, "owner_id": owner_id, "payout_entry_id": pe["entry_id"],
                    "source_line_id": u["line_id"], "kind": u["kind"], "invoice_id": u.get("invoice_id"),
                    "room_id": u.get("room_id"), "building_id": u.get("building_id"), "amount": take,
                    "paid_date": pe["entry_date"] or str(date.today()), "is_legacy_apply": True,
                }
            )
            u["remaining"] = round(u["remaining"] - take, 2)
            left = round(left - take, 2)
    if rows:
        supabase.table("owner_payout_allocations").insert(rows).execute()
    return {"message": "Earlier payouts applied to oldest open rent", "allocations_created": len(rows)}


class PayOwnerDirectRequest(BaseModel):
    owner_id: str
    amount_paid: float
    paid_date: Optional[date] = None
    building_id: Optional[str] = None
    # Which account this actually left from (Bank, Cash, a specific bank
    # account, etc.) -- selected by the user on the payout page, the same
    # way /payments/receipt requires a real account_id rather than assuming
    # one. No default: a payout with the wrong account silently corrupts
    # that account's balance, so it's never guessed.
    account_id: str
    payment_method: str = "bank_transfer"  # 'cash' | 'bank_transfer' | 'cheque' | 'other'
    notes: Optional[str] = None


@router.post("/pay-owner")
def pay_owner_direct(
    payload: PayOwnerDirectRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Records a payout straight against an owner's real balance -- Dr Due to
    Owners (or whichever transfers_to_owner account it's tied to) / Cr
    whichever account the money actually left from -- without needing a
    matching row in the legacy owner_ledger snapshot table (see /balances
    above). This is what the Owners page's full-page "Pay" screen calls.
    """
    if payload.amount_paid <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero.")

    account = (
        supabase.table("chart_of_accounts")
        .select("id")
        .eq("id", payload.account_id)
        .eq("company_id", company_id)
        .single()
        .execute()
    )
    if not account.data:
        raise HTTPException(status_code=404, detail="Account not found")

    paid_date = payload.paid_date or date.today()
    due_to_owners_id = get_account_id(supabase, company_id, "2200")

    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(paid_date),
        source_type="owner_payout",
        source_id=None,
        description=(payload.notes or f"Owner payout — {str(paid_date)}"),
        lines=[
            {
                "account_id": due_to_owners_id,
                "direction": "debit",
                "amount": payload.amount_paid,
                "building_id": payload.building_id,
                "owner_id": payload.owner_id,
            },
            {
                "account_id": payload.account_id,
                "direction": "credit",
                "amount": payload.amount_paid,
                "building_id": payload.building_id,
                "owner_id": payload.owner_id,
            },
        ],
    )
    return {"message": "Payout recorded", "owner_id": payload.owner_id, "amount_paid": payload.amount_paid}


@router.post("/compute", status_code=201)
def compute_ledger(
    payload: ComputeRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Computes (or recomputes) a building's owner ledger for a given month.

    IMPORTANT: since rooms can now override their building's default owner
    (a building isn't guaranteed to have exactly one owner), this returns a
    LIST of rows -- one per owner who has rent activity in this building
    this month, plus always the building's own default owner (since
    building-wide expenses/salary allocation are attributed to them even in
    a month where their rooms happened to collect nothing).

    Rent collected is read from journal_lines (only the Rent Income
    account, tagged per-owner) rather than summing whole invoice totals --
    that's what makes it correct when a single invoice mixes rent with
    other non-owner charges like electricity recovery.
    """
    ledger_month = payload.month.replace(day=1)
    next_month = (
        date(ledger_month.year + 1, 1, 1)
        if ledger_month.month == 12
        else date(ledger_month.year, ledger_month.month + 1, 1)
    )

    room_ids = [
        r["id"]
        for r in supabase.table("rooms")
        .select("id")
        .eq("building_id", payload.building_id)
        .execute()
        .data
    ]
    lease_ids = [
        l["id"]
        for l in supabase.table("leases")
        .select("id")
        .in_("room_id", room_ids)
        .execute()
        .data
    ] if room_ids else []

    # --- Rent collected, split by owner, via the actual ledger -------------
    collected_by_owner: dict[str, float] = {}
    if lease_ids:
        paid_invoices = (
            supabase.table("invoices")
            .select("id")
            .in_("lease_id", lease_ids)
            .gte("invoice_month", str(ledger_month))
            .lt("invoice_month", str(next_month))
            .in_("status", ["paid", "partial"])
            .execute()
            .data
        )
        invoice_ids = [i["id"] for i in paid_invoices]

        if invoice_ids:
            # Rent (and anything else tagged owner-transferring) now credits
            # the Due to Owners LIABILITY directly at invoice time -- it was
            # never the company's own income. This account's own credits
            # ARE the owner's payable ledger now, so this query just reads
            # straight off it rather than an income account.
            owner_liability_account_id = get_account_id(supabase, company_id, "2200")
            entries = (
                supabase.table("journal_entries")
                .select("id")
                .eq("source_type", "invoice")
                .in_("source_id", invoice_ids)
                .execute()
                .data
            )
            entry_ids = [e["id"] for e in entries]
            if entry_ids:
                rent_lines = (
                    supabase.table("journal_lines")
                    .select("amount, owner_id")
                    .in_("journal_entry_id", entry_ids)
                    .eq("account_id", owner_liability_account_id)
                    .execute()
                    .data
                )
                for line in rent_lines:
                    if line.get("owner_id"):
                        collected_by_owner[line["owner_id"]] = (
                            collected_by_owner.get(line["owner_id"], 0.0) + float(line["amount"])
                        )

    # --- Building-wide expenses + allocated salary, attributed to the ------
    # --- building's own default owner (expenses aren't recorded per-room) --
    building = supabase.table("buildings").select("owner_id").eq("id", payload.building_id).single().execute().data
    building_owner_id = building.get("owner_id") if building else None

    expenses = (
        supabase.table("expenses")
        .select("amount")
        .eq("building_id", payload.building_id)
        .gte("expense_date", str(ledger_month))
        .lt("expense_date", str(next_month))
        .execute()
        .data
    )
    total_expenses = sum(float(e["amount"]) for e in expenses)

    allocations = (
        supabase.table("cost_allocations")
        .select("source_type, source_id, allocation_type, value")
        .eq("building_id", payload.building_id)
        .execute()
        .data
    )
    allocated_cost = 0.0
    for alloc in allocations:
        if alloc["source_type"] == "staff":
            payments_this_month = (
                supabase.table("salary_payments")
                .select("amount_paid")
                .eq("staff_id", alloc["source_id"])
                .gte("salary_month", str(ledger_month))
                .lt("salary_month", str(next_month))
                .execute()
                .data
            )
            base_amount = sum(float(p["amount_paid"]) for p in payments_this_month)
        else:  # 'expense' -- a recurring expense being split across buildings
            base_amount = float(
                (supabase.table("expenses").select("amount").eq("id", alloc["source_id"]).single().execute().data or {}).get("amount", 0)
            )
        if base_amount == 0:
            continue
        if alloc["allocation_type"] == "percentage":
            allocated_cost += base_amount * (float(alloc["value"]) / 100)
        else:  # fixed
            allocated_cost += min(float(alloc["value"]), base_amount)
    total_expenses += allocated_cost

    # Every owner who collected rent this month gets a row; the building's
    # own default owner always gets a row too (even at 0 collected) since
    # they're the one wearing the building's expenses/salary allocation.
    owner_ids = set(collected_by_owner.keys())
    if building_owner_id:
        owner_ids.add(building_owner_id)

    results = []
    for owner_id in owner_ids:
        owner_collected = collected_by_owner.get(owner_id, 0.0)
        owner_expenses = total_expenses if owner_id == building_owner_id else 0.0
        amount_payable = owner_collected - owner_expenses

        existing = (
            supabase.table("owner_ledger")
            .select("id")
            .eq("owner_id", owner_id)
            .eq("building_id", payload.building_id)
            .eq("ledger_month", str(ledger_month))
            .execute()
            .data
        )

        row = {
            "company_id": company_id,
            "owner_id": owner_id,
            "building_id": payload.building_id,
            "ledger_month": str(ledger_month),
            "total_collected": owner_collected,
            "total_expenses": owner_expenses,
            "amount_payable": amount_payable,
        }

        if existing:
            result = supabase.table("owner_ledger").update(row).eq("id", existing[0]["id"]).execute()
        else:
            result = supabase.table("owner_ledger").insert(row).execute()
        results.append(result.data[0])

    return results


@router.post("/{ledger_id}/pay")
def pay_owner(
    ledger_id: str,
    payload: PayRequest,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    ledger = supabase.table("owner_ledger").select("*").eq("id", ledger_id).single().execute()
    if not ledger.data:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    status = "paid" if payload.amount_paid >= float(ledger.data["amount_payable"]) else "partial"
    paid_date = payload.paid_date or date.today()
    result = (
        supabase.table("owner_ledger")
        .update(
            {
                "amount_paid": payload.amount_paid,
                "paid_date": str(paid_date),
                "status": status,
            }
        )
        .eq("id", ledger_id)
        .execute()
    )

    # Dr Due to Owners / Cr Bank -- the actual cash leaving for this payout.
    due_to_owners_id = get_account_id(supabase, company_id, "2200")
    bank_id = get_account_id(supabase, company_id, "1000")
    post_journal_entry(
        supabase,
        company_id=company_id,
        entry_date=str(paid_date),
        source_type="owner_payout",
        source_id=ledger_id,
        description=f"Owner payout - {ledger.data['ledger_month']}",
        lines=[
            {
                "account_id": due_to_owners_id,
                "direction": "debit",
                "amount": payload.amount_paid,
                "building_id": ledger.data["building_id"],
                "owner_id": ledger.data.get("owner_id"),
            },
            {
                "account_id": bank_id,
                "direction": "credit",
                "amount": payload.amount_paid,
                "building_id": ledger.data["building_id"],
                "owner_id": ledger.data.get("owner_id"),
            },
        ],
    )

    return result.data[0]
