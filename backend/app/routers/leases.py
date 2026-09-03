from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.core.deps import get_current_company_id, get_current_user, get_supabase
from app.crud.generic import write_audit_log
from app.services.ledger import get_account_id, get_lease_receivable_balance, post_journal_entry, resolve_room_owner
from app.services.invoicing import resync_current_month_invoice
from app.services.lease_settlement import compute_settlement_preview, finalize_settlement
from app.routers.invoices import generate_invoice_for_lease

router = APIRouter(prefix="/leases", tags=["Leases"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class LeaseCharge(BaseModel):
    label: str
    amount: float
    recurrence: str = "recurring"  # 'recurring' | 'one_time' -- e.g. Rent vs a one-off Commission fee
    # Whether this line prints on the invoice PDF. Checked by default --
    # unchecking still counts the amount fully toward the total and the
    # ledger, it only hides that one printed row (e.g. folding a facility
    # quietly into the headline rent shown to the tenant).
    show_on_invoice: bool = True


class LeaseCreate(BaseModel):
    tenant_id: str
    room_id: str
    start_date: date
    end_date: date
    agreement_doc_url: str | None = None
    charges: List[LeaseCharge]  # e.g. [{"label": "Rent", "amount": 20000}, ...]
    security_deposit_amount: float
    security_deposit_date_received: date
    # Whether the deposit was actually collected at signing. When False,
    # no journal entry is posted here -- use POST
    # /security-deposits/{id}/receive later, once it's actually collected.
    security_deposit_is_received: bool = True
    # Which asset account (Bank, Cash, etc.) the deposit was received into --
    # required only when security_deposit_is_received is True and the
    # deposit amount is > 0. Different companies use different account
    # codes, so this is never assumed/hardcoded.
    security_deposit_received_account_id: str | None = None


class ChargeUpdate(BaseModel):
    new_amount: float
    effective_from: date | None = None  # defaults to today
    show_on_invoice: bool | None = None  # if omitted, keeps the charge's current setting


class ChargeAdd(BaseModel):
    label: str
    amount: float
    recurrence: str = "recurring"  # 'recurring' | 'one_time'
    effective_from: date | None = None  # defaults to today
    show_on_invoice: bool = True


class ChargeEnd(BaseModel):
    effective_to: date | None = None  # defaults to today -- last day this charge still applies
    reason: str | None = None


class TerminateRequest(BaseModel):
    reason: str | None = None


class SettlementDeduction(BaseModel):
    reason: str
    amount: float
    account_id: Optional[str] = None  # which account this deduction posts to (usually income)


class SettlementFinalize(BaseModel):
    move_out_date: date
    discount_amount: float = 0
    discount_account_id: Optional[str] = None
    discount_reason: Optional[str] = None
    deductions: List[SettlementDeduction] = []
    show_full_detail_on_pdf: bool = True
    refund_date: Optional[date] = None
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("")
def list_leases(supabase: Client = Depends(get_supabase)):
    res = supabase.table("leases").select("*").order("created_at", desc=True).execute()
    return res.data


@router.get("/{lease_id}")
def get_lease(lease_id: str, supabase: Client = Depends(get_supabase)):
    res = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Lease not found")
    return res.data


@router.get("/{lease_id}/receivable-summary")
def get_lease_receivable_summary(
    lease_id: str,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Powers the Receive Payment screen: every invoice for this lease that
    isn't fully settled yet (oldest first, so the frontend can default the
    checklist to "apply oldest first"), each with its own remaining
    balance, plus the lease's overall running balance straight from the
    ledger. The running balance can be LOWER than the sum of the invoice
    balances shown (if the tenant has an unapplied advance sitting on the
    lease) or even negative (advance exceeds everything currently owed) --
    that's expected, not a bug; it's the actual net position.
    """
    lease = supabase.table("leases").select("id, tenant_id, room_id").eq("id", lease_id).single().execute()
    if not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")

    invoices = (
        supabase.table("invoices")
        .select("*")
        .eq("lease_id", lease_id)
        .neq("status", "cancelled")
        .order("invoice_month")
        .execute()
        .data
    )

    outstanding = []
    for inv in invoices:
        payments = (
            supabase.table("payments")
            .select("amount, discount_amount")
            .eq("invoice_id", inv["id"])
            .execute()
            .data
        )
        settled = sum(float(p["amount"]) + float(p.get("discount_amount") or 0) for p in payments)
        balance = round(float(inv["total_amount"]) - settled, 2)
        if balance > 0.01:
            outstanding.append({**inv, "balance": balance})

    running_balance = get_lease_receivable_balance(supabase, company_id, lease_id)

    # Anything owed that ISN'T tied to one of the outstanding invoices above
    # -- most commonly a manual journal entry (e.g. a receivable posted by
    # hand through the Journal Entry form, tagged to this tenant/lease)
    # rather than an invoice. running_balance is the true ledger total; the
    # invoices above only cover the invoice-tied portion of it, so whatever
    # is left over is exactly this. Floored at 0 so a tenant advance (which
    # already makes running_balance negative/lower) never shows here as a
    # negative "opening balance" to tick.
    outstanding_total = round(sum(o["balance"] for o in outstanding), 2)
    opening_balance = max(round(running_balance - outstanding_total, 2), 0.0)

    return {
        "lease_id": lease_id,
        "tenant_id": lease.data["tenant_id"],
        "room_id": lease.data["room_id"],
        "outstanding_invoices": outstanding,
        "opening_balance": opening_balance,
        "running_balance": running_balance,
    }


class LeaseEdit(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    agreement_doc_url: str | None = None


@router.patch("/{lease_id}")
def edit_lease(
    lease_id: str,
    payload: LeaseEdit,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """Edits a lease's dates (e.g. fixing a typo made at creation)."""
    before = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not before.data:
        raise HTTPException(status_code=404, detail="Lease not found")

    updates = {k: str(v) if v is not None else None for k, v in payload.model_dump(exclude_unset=True).items()}
    updates = {k: v for k, v in updates.items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = supabase.table("leases").update(updates).eq("id", lease_id).execute()
    after = res.data[0]
    write_audit_log(supabase, company_id, user["user_id"], "update", "leases", lease_id, before.data, after)
    return after


@router.post("", status_code=201)
def create_lease(
    payload: LeaseCreate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Creates a lease + its initial rent-component charges + its security
    deposit in one call, and marks the room as occupied.

    Note: supabase-py talks to PostgREST over HTTP, so this isn't a single
    atomic DB transaction. For an MVP this is an acceptable trade-off; if you
    want true atomicity later, wrap this logic in a single Postgres function
    and call it via supabase.rpc() instead.
    """
    existing_active = (
        supabase.table("leases")
        .select("id, room_id")
        .eq("tenant_id", payload.tenant_id)
        .eq("status", "active")
        .execute()
    )
    if existing_active.data:
        room = (
            supabase.table("rooms")
            .select("room_number, building_id")
            .eq("id", existing_active.data[0]["room_id"])
            .single()
            .execute()
        )
        room_label = room.data["room_number"] if room.data else "another room"
        raise HTTPException(
            status_code=400,
            detail=(
                f"This tenant already has an active lease (room {room_label}). "
                "Terminate the existing lease before creating a new one."
            ),
        )

    lease_row = {
        "company_id": company_id,
        "tenant_id": payload.tenant_id,
        "room_id": payload.room_id,
        "start_date": str(payload.start_date),
        "end_date": str(payload.end_date),
        "agreement_doc_url": payload.agreement_doc_url,
        "status": "active",
    }
    lease_res = supabase.table("leases").insert(lease_row).execute()
    if not lease_res.data:
        raise HTTPException(status_code=400, detail="Failed to create lease")
    lease = lease_res.data[0]
    lease_id = lease["id"]

    try:
        for c in payload.charges:
            if c.recurrence not in ("recurring", "one_time"):
                raise HTTPException(status_code=400, detail=f"Invalid recurrence for '{c.label}': must be 'recurring' or 'one_time'")

        charge_rows = [
            {
                "company_id": company_id,
                "lease_id": lease_id,
                "label": c.label,
                "amount": c.amount,
                "recurrence": c.recurrence,
                "effective_from": str(payload.start_date),
                "show_on_invoice": c.show_on_invoice,
            }
            for c in payload.charges
        ]
        supabase.table("lease_charges").insert(charge_rows).execute()

        if payload.security_deposit_amount > 0 and payload.security_deposit_is_received and not payload.security_deposit_received_account_id:
            raise HTTPException(
                status_code=400,
                detail="Select which account the security deposit was received into, or mark it as not yet collected.",
            )

        supabase.table("security_deposits").insert(
            {
                "company_id": company_id,
                "lease_id": lease_id,
                "amount_received": payload.security_deposit_amount,
                "date_received": str(payload.security_deposit_date_received),
                "status": "held",
                "is_received": payload.security_deposit_is_received,
                "received_account_id": payload.security_deposit_received_account_id
                if payload.security_deposit_is_received
                else None,
            }
        ).execute()

        supabase.table("rooms").update({"status": "occupied"}).eq(
            "id", payload.room_id
        ).execute()

        # Dr [account tenant actually paid into] / Cr Security Deposits Held --
        # cash received, held as a liability until it's refunded (or partially
        # retained) later via security_deposits.py's /refund endpoint.
        # Only posts when the deposit was actually collected at signing --
        # if not, this is deferred to POST /security-deposits/{id}/receive.
        if payload.security_deposit_amount > 0 and payload.security_deposit_is_received:
            received_account_id = payload.security_deposit_received_account_id
            deposits_held_id = get_account_id(supabase, company_id, "2100")
            owner_id = resolve_room_owner(supabase, payload.room_id)
            room = supabase.table("rooms").select("room_number, building_id").eq("id", payload.room_id).single().execute().data
            building_id = room["building_id"] if room else None
            room_label = room.get("room_number", "room") if room else "room"
            tenant = supabase.table("tenants").select("full_name").eq("id", payload.tenant_id).single().execute().data
            tenant_name = tenant["full_name"] if tenant else "Tenant"

            post_journal_entry(
                supabase,
                company_id=company_id,
                entry_date=str(payload.security_deposit_date_received),
                source_type="security_deposit",
                source_id=lease_id,
                description=f"Security deposit — {tenant_name}, Room {room_label}",
                lines=[
                    {
                        "account_id": received_account_id, "direction": "debit", "amount": payload.security_deposit_amount,
                        "building_id": building_id, "room_id": payload.room_id, "owner_id": owner_id,
                        "tenant_id": payload.tenant_id, "lease_id": lease_id,
                    },
                    {
                        "account_id": deposits_held_id, "direction": "credit", "amount": payload.security_deposit_amount,
                        "building_id": building_id, "room_id": payload.room_id, "owner_id": owner_id,
                        "tenant_id": payload.tenant_id, "lease_id": lease_id,
                    },
                ],
            )
    except Exception as e:
        # Best-effort rollback since this isn't a real DB transaction.
        supabase.table("leases").delete().eq("id", lease_id).execute()
        raise HTTPException(status_code=400, detail=f"Failed to fully create lease: {e}")

    # Auto-generate the lease's first invoice right now, rather than waiting
    # for the next monthly batch run -- so there's an actual invoice_id to
    # share with the tenant (WhatsApp link, PDF) immediately at signing.
    # Best-effort: if this fails for any reason, the lease itself is still
    # valid -- the monthly batch generator would pick it up as a fallback.
    first_invoice = None
    try:
        invoice_month = payload.start_date.replace(day=1)
        due_date = payload.start_date + timedelta(days=7)
        first_invoice = generate_invoice_for_lease(supabase, company_id, lease, invoice_month, due_date)
    except Exception:
        pass

    return {
        "lease": lease,
        "first_invoice": first_invoice,
        "message": "Lease, charges, and deposit created" + (" — first invoice generated" if first_invoice else ""),
    }


@router.get("/{lease_id}/charges")
def get_active_charges(lease_id: str, supabase: Client = Depends(get_supabase)):
    """Returns only the currently-in-effect charges (effective_to is null)."""
    res = (
        supabase.table("lease_charges")
        .select("*")
        .eq("lease_id", lease_id)
        .is_("effective_to", "null")
        .execute()
    )
    return res.data


@router.get("/{lease_id}/charges/history")
def get_charge_history(lease_id: str, supabase: Client = Depends(get_supabase)):
    """Every charge row that has ever existed on this lease, including
    closed-out ones -- powers the "History" panel on the edit-lease screen
    so every past add/amount-change/removal is visible, not just what's
    active right now."""
    res = (
        supabase.table("lease_charges")
        .select("*")
        .eq("lease_id", lease_id)
        .order("effective_from")
        .execute()
    )
    return res.data


def _lease_or_404(supabase: Client, lease_id: str) -> dict:
    lease = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")
    return lease.data


def _resync_result(supabase: Client, company_id: str, lease: dict) -> dict:
    """Runs resync_current_month_invoice and turns the result into a plain
    message the frontend can show directly -- "this month's invoice was
    updated" vs "nothing to update yet"."""
    updated_invoice = resync_current_month_invoice(supabase, company_id, lease)
    if updated_invoice:
        return {
            "current_invoice_updated": True,
            "current_invoice_id": updated_invoice["id"],
            "current_invoice_new_total": updated_invoice["total_amount"],
            "impact_message": (
                f"This month's invoice was updated — new total Rs {updated_invoice['total_amount']:,.0f}. "
                "No past invoice was changed."
            ),
        }
    return {
        "current_invoice_updated": False,
        "current_invoice_id": None,
        "current_invoice_new_total": None,
        "impact_message": (
            "This will apply starting with the next invoice generated for this lease. "
            "No past invoice was changed. (If a current-month invoice already has a "
            "payment recorded against it, it's left as-is on purpose.)"
        ),
    }


@router.post("/{lease_id}/resync-current-invoice")
def resync_current_invoice_endpoint(
    lease_id: str,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Manually recalculates this lease's current-month invoice from whatever
    charges are on it right now -- without needing to touch a charge to
    trigger it. Useful after fixing lease_charges directly (e.g. a data
    cleanup), or just to double-check the invoice matches the charges.
    Same safe rule as every other charge action: only ever touches a
    current-month invoice that's still a draft with no payment recorded.
    """
    lease = _lease_or_404(supabase, lease_id)
    return _resync_result(supabase, company_id, lease)


@router.post("/{lease_id}/charges", status_code=201)
def add_charge(
    lease_id: str,
    payload: ChargeAdd,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """
    Adds a new charge to a lease at any point during its term -- e.g. a
    tenant asks for parking starting today. Never touches past invoices;
    if this month's invoice already exists and has no payment recorded
    against it yet, it's recalculated to include this charge (prorated
    for the days remaining in the month); otherwise it simply becomes
    part of the lease's normal charge set from now on.
    """
    lease = _lease_or_404(supabase, lease_id)
    if payload.recurrence not in ("recurring", "one_time"):
        raise HTTPException(status_code=400, detail="recurrence must be 'recurring' or 'one_time'")

    effective_from = payload.effective_from or date.today()
    row = {
        "company_id": company_id,
        "lease_id": lease_id,
        "label": payload.label,
        "amount": payload.amount,
        "recurrence": payload.recurrence,
        "effective_from": str(effective_from),
        "show_on_invoice": payload.show_on_invoice,
    }
    new_charge = supabase.table("lease_charges").insert(row).execute().data[0]
    write_audit_log(supabase, company_id, user["user_id"], "create", "lease_charges", new_charge["id"], None, new_charge)

    result = _resync_result(supabase, company_id, lease)
    return {"charge": new_charge, **result}


@router.patch("/{lease_id}/charges/{charge_id}")
def update_charge_amount(
    lease_id: str,
    charge_id: str,
    payload: ChargeUpdate,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """
    Edits a rent-component amount (e.g. water fee 1000 -> 1200) WITHOUT
    overwriting history. Closes the old charge row and inserts a new one,
    so past invoices remain accurate. Also patches this month's invoice
    (if it exists and has no payment against it yet) to reflect the new
    amount going forward.
    """
    lease = _lease_or_404(supabase, lease_id)
    effective_date = payload.effective_from or date.today()

    old = (
        supabase.table("lease_charges")
        .select("*")
        .eq("id", charge_id)
        .single()
        .execute()
    )
    if not old.data:
        raise HTTPException(status_code=404, detail="Charge not found")
    if old.data.get("effective_to") is not None:
        raise HTTPException(status_code=400, detail="This charge has already been closed out by a later change — edit the newer version of it instead.")
    if effective_date < date.fromisoformat(str(old.data["effective_from"])):
        raise HTTPException(
            status_code=400,
            detail=f"The effective date can't be before {old.data['effective_from']}, which is when this charge itself started.",
        )

    supabase.table("lease_charges").update(
        {"effective_to": str(effective_date)}
    ).eq("id", charge_id).execute()

    new_row = (
        supabase.table("lease_charges")
        .insert(
            {
                "company_id": company_id,
                "lease_id": lease_id,
                "label": old.data["label"],
                "amount": payload.new_amount,
                "recurrence": old.data.get("recurrence", "recurring"),
                "effective_from": str(effective_date),
                "show_on_invoice": payload.show_on_invoice if payload.show_on_invoice is not None else old.data.get("show_on_invoice", True),
            }
        )
        .execute()
        .data[0]
    )
    write_audit_log(supabase, company_id, user["user_id"], "update", "lease_charges", charge_id, old.data, new_row)

    result = _resync_result(supabase, company_id, lease)
    return {"charge": new_row, **result}


@router.post("/{lease_id}/charges/{charge_id}/end")
def end_charge(
    lease_id: str,
    charge_id: str,
    payload: ChargeEnd,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """
    Stops a charge from a given date onward (e.g. parking no longer
    needed) -- WITHOUT deleting its history, so past invoices that already
    billed it stay accurate. Also patches this month's invoice (if it
    exists and has no payment against it yet) to drop or prorate-down
    that charge.
    """
    lease = _lease_or_404(supabase, lease_id)
    effective_to = payload.effective_to or date.today()

    old = supabase.table("lease_charges").select("*").eq("id", charge_id).single().execute()
    if not old.data:
        raise HTTPException(status_code=404, detail="Charge not found")
    if old.data.get("effective_to") is not None:
        raise HTTPException(status_code=400, detail="This charge has already been ended")
    if effective_to < date.fromisoformat(str(old.data["effective_from"])):
        raise HTTPException(
            status_code=400,
            detail=f"The end date can't be before {old.data['effective_from']}, which is when this charge itself started.",
        )

    updated = (
        supabase.table("lease_charges")
        .update({"effective_to": str(effective_to)})
        .eq("id", charge_id)
        .execute()
        .data[0]
    )
    write_audit_log(
        supabase, company_id, user["user_id"], "update", "lease_charges", charge_id,
        old.data, {**updated, "_reason": payload.reason} if payload.reason else updated,
    )

    result = _resync_result(supabase, company_id, lease)
    return {"charge": updated, **result}


@router.post("/{lease_id}/terminate")
def terminate_lease(
    lease_id: str,
    payload: TerminateRequest,
    supabase: Client = Depends(get_supabase),
):
    """
    Quick close with no billing/settlement -- just ends the lease and frees
    the room. Does NOT touch invoices or the security deposit. For a real
    move-out with dues to collect or a deposit to refund, use the
    settlement flow below (GET .../settlement-preview then POST
    .../settlement) instead -- it computes and posts all of that properly.
    """
    lease = supabase.table("leases").select("*").eq("id", lease_id).single().execute()
    if not lease.data:
        raise HTTPException(status_code=404, detail="Lease not found")

    supabase.table("leases").update(
        {
            "status": "terminated",
            "terminated_at": str(date.today()),
            "termination_reason": payload.reason,
        }
    ).eq("id", lease_id).execute()

    supabase.table("rooms").update({"status": "vacant"}).eq(
        "id", lease.data["room_id"]
    ).execute()

    return {"message": "Lease terminated, room marked vacant"}


# ---------------------------------------------------------------------------
# Lease closing / settlement statement
# ---------------------------------------------------------------------------
@router.get("/{lease_id}/settlement-preview")
def settlement_preview(
    lease_id: str,
    move_out_date: date,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
):
    """
    Read-only preview for the "Close lease" screen -- recomputes fully on
    every call (cheap: a handful of indexed queries, no writes) so moving
    the move-out date recalculates the outstanding balance, the final
    prorated period, and the deposit position live, entirely server-side.
    """
    return compute_settlement_preview(supabase, company_id, lease_id, move_out_date)


@router.post("/{lease_id}/settlement", status_code=201)
def close_lease_with_settlement(
    lease_id: str,
    payload: SettlementFinalize,
    supabase: Client = Depends(get_supabase),
    company_id: str = Depends(get_current_company_id),
    user: dict = Depends(get_current_user),
):
    """
    Finalizes a lease closing: corrects/creates the final period's invoice,
    posts the discount (if any), applies deduction lines to the security
    deposit, refunds whatever's left after outstanding dues are cleared,
    and marks the lease terminated as of the actual move-out date. Returns
    the saved settlement record -- fetch its PDF via
    GET /leases/settlements/{id}/pdf.
    """
    for d in payload.deductions:
        if d.amount > 0 and not d.account_id:
            raise HTTPException(
                status_code=400,
                detail=f"Select which account the deduction '{d.reason}' should be charged to.",
            )

    settlement = finalize_settlement(
        supabase,
        company_id=company_id,
        lease_id=lease_id,
        move_out_date=payload.move_out_date,
        discount_amount=payload.discount_amount,
        discount_account_id=payload.discount_account_id,
        discount_reason=payload.discount_reason,
        deductions=[d.model_dump() for d in payload.deductions],
        show_full_detail_on_pdf=payload.show_full_detail_on_pdf,
        refund_date=payload.refund_date,
        reason=payload.reason,
        created_by=user["user_id"],
    )
    write_audit_log(supabase, company_id, user["user_id"], "close_lease", "leases", lease_id, None, settlement)
    return settlement


@router.get("/settlements/{settlement_id}")
def get_settlement(settlement_id: str, supabase: Client = Depends(get_supabase)):
    res = supabase.table("lease_settlements").select("*").eq("id", settlement_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Settlement not found")
    return res.data


@router.get("/settlements/{settlement_id}/pdf")
def settlement_pdf(settlement_id: str, supabase: Client = Depends(get_supabase)):
    """
    Professional printable settlement statement. Shows full itemized detail
    or just the single net-balance line, exactly as chosen when the
    settlement was finalized (show_full_detail_on_pdf) -- not recalculated
    against today's books, so it always matches what was actually agreed.
    """
    from fastapi.responses import StreamingResponse
    import io

    from app.services.settlement_pdf import fetch_settlement_context, render_settlement_pdf

    ctx = fetch_settlement_context(supabase, settlement_id)
    pdf_bytes = render_settlement_pdf(ctx)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="settlement_{settlement_id}.pdf"'},
    )
