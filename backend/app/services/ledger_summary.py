"""
Period totals (collected / expenses / salaries / net profit) computed from
ONE place: the journal.

WHY THIS EXISTS
The dashboard used to add up three separate operational tables (payments,
expenses, salary_payments). Anything that reached the books by another route
-- a manual journal voucher, a move-out discount, an imported entry -- never
showed up there, so the cards disagreed with the Journal, Trial Balance and
Profit & Loss. Every money-moving screen already posts to journal_lines, so
the cards now read from there and from nowhere else.

DEFINITIONS (all net of reversals: a reversed entry and its reversal carry
the same date and source type, so the pair nets to zero in any period)
  collected  net debits on bank/cash accounts from tenant receipts/payments
             (source_type 'receipt' or 'payment'). Deposits, owner payouts
             and bank-to-bank transfers are not "collections".
  salaries   net debits on the Salaries Expense account (code 5400), from
             any source (salary payments or a manual voucher).
  expenses   net debits on every OTHER expense-type account, from any source
             -- bills, manual vouchers, move-out discounts, and so on.
  net_profit collected - expenses - salaries (same formula the dashboard has
             always shown, now fed from the ledger).
"""

from calendar import monthrange
from datetime import date, timedelta
from typing import Optional

from supabase import Client

from app.services.invoice_batch import IN_CHUNK, chunked, fetch_all

SALARY_ACCOUNT_CODE = "5400"
COLLECTION_SOURCE_TYPES = ("receipt", "payment")


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=monthrange(d.year, d.month)[1])


def add_months(d: date, n: int) -> date:
    """First day of the month n months after d's month (n may be negative)."""
    idx = d.year * 12 + (d.month - 1) + n
    return date(idx // 12, idx % 12 + 1, 1)


def month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def load_accounts(supabase: Client, company_id: str) -> dict:
    """Classifies the company's chart of accounts once."""
    rows = fetch_all(
        lambda: supabase.table("chart_of_accounts")
        .select("id, code, name, account_type, is_cash_or_bank")
        .eq("company_id", company_id)
        .order("id")
    )
    return {
        "by_id": {r["id"]: r for r in rows},
        "cash_bank": {r["id"] for r in rows if r.get("is_cash_or_bank") or r["code"] == "1000"},
        "salary": {r["id"] for r in rows if r["code"] == SALARY_ACCOUNT_CODE},
        "expense": {r["id"] for r in rows if r["account_type"] == "expense" and r["code"] != SALARY_ACCOUNT_CODE},
    }


def fetch_lines(
    supabase: Client,
    company_id: str,
    date_from: date,
    date_to: date,
    account_ids: set,
    columns: str,
) -> list[dict]:
    """Every journal line on the given accounts within [date_from, date_to],
    read page by page (PostgREST silently caps a read at 1000 rows)."""
    out: list[dict] = []
    for chunk in chunked(sorted(account_ids), IN_CHUNK):
        def q(chunk=chunk):
            return (
                supabase.table("v_journal_detail")
                .select(columns)
                .eq("company_id", company_id)
                .in_("account_id", chunk)
                .gte("entry_date", str(date_from))
                .lte("entry_date", str(date_to))
                .order("line_id")
            )
        out.extend(fetch_all(q))
    return out


def _signed(line: dict) -> float:
    """Debit-positive amount (these figures are all debit-natured: cash in,
    expense incurred)."""
    amt = float(line["amount"])
    return amt if line["direction"] == "debit" else -amt


def previous_period(date_from: date, date_to: date) -> tuple[date, date]:
    """The period to compare against. A whole calendar month is compared with
    the whole previous calendar month; anything else with the equal-length
    stretch immediately before it."""
    if date_from.day == 1 and date_to >= date_from and month_start(date_to) == date_from and date_to == month_end(date_to):
        prev_start = add_months(date_from, -1)
        return prev_start, month_end(prev_start)
    if date_from.day == 1 and month_start(date_to) == date_from:
        # Month-to-date: compare with the same days of the previous month.
        prev_start = add_months(date_from, -1)
        prev_end = min(prev_start + timedelta(days=date_to.day - 1), month_end(prev_start))
        return prev_start, prev_end
    length = (date_to - date_from).days + 1
    prev_end = date_from - timedelta(days=1)
    return prev_end - timedelta(days=length - 1), prev_end


def build_summary(supabase: Client, company_id: str, date_from: date, date_to: date, trend_length: int = 6) -> dict:
    accounts = load_accounts(supabase, company_id)
    prev_from, prev_to = previous_period(date_from, date_to)

    trend_months = [add_months(month_start(date_to), -i) for i in range(trend_length - 1, -1, -1)]
    fetch_from = min(date_from, prev_from, trend_months[0])
    fetch_to = max(date_to, prev_to, month_end(trend_months[-1]))

    wanted = accounts["cash_bank"] | accounts["salary"] | accounts["expense"]
    lines = (
        fetch_lines(
            supabase, company_id, fetch_from, fetch_to, wanted,
            "line_id, entry_date, account_id, direction, amount, source_type",
        )
        if wanted
        else []
    )

    def empty():
        return {"collected": 0.0, "expenses": 0.0, "salaries": 0.0}

    def classify(line: dict) -> Optional[str]:
        acct = line["account_id"]
        if acct in accounts["salary"]:
            return "salaries"
        if acct in accounts["expense"]:
            return "expenses"
        if acct in accounts["cash_bank"] and line.get("source_type") in COLLECTION_SOURCE_TYPES:
            return "collected"
        return None

    def totals_between(start: date, end: date) -> dict:
        t = empty()
        for l in lines:
            d = date.fromisoformat(l["entry_date"][:10])
            if start <= d <= end:
                bucket = classify(l)
                if bucket:
                    t[bucket] += _signed(l)
        return _finish(t)

    def _finish(t: dict) -> dict:
        t = {k: round(v, 2) for k, v in t.items()}
        t["net_profit"] = round(t["collected"] - t["expenses"] - t["salaries"], 2)
        return t

    trend = []
    for m in trend_months:
        t = totals_between(m, month_end(m))
        trend.append({"month": month_key(m), **t})

    breakdown: dict[str, float] = {}
    for l in lines:
        d = date.fromisoformat(l["entry_date"][:10])
        if not (date_from <= d <= date_to):
            continue
        if classify(l) in ("expenses", "salaries"):
            breakdown[l["account_id"]] = breakdown.get(l["account_id"], 0.0) + _signed(l)
    expense_breakdown = sorted(
        (
            {
                "account_id": aid,
                "code": accounts["by_id"][aid]["code"],
                "name": accounts["by_id"][aid]["name"],
                "amount": round(amt, 2),
            }
            for aid, amt in breakdown.items()
            if abs(amt) >= 0.005
        ),
        key=lambda r: -r["amount"],
    )

    return {
        "date_from": str(date_from),
        "date_to": str(date_to),
        "current": totals_between(date_from, date_to),
        "previous": totals_between(prev_from, prev_to),
        "previous_period": {"date_from": str(prev_from), "date_to": str(prev_to)},
        "trend": trend,
        "expense_breakdown": expense_breakdown,
    }
