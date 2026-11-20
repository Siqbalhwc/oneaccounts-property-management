"""
Shared helpers for reading data that can exceed the database's per-request cap.

The database API returns at most 1,000 rows per request and does NOT say when
it has cut a result short, and a very long list of ids in one request can
exceed the web-address length limit. Anything that reads a table which grows
with the business (payments, invoices, journal lines, ...) must read through
these helpers instead of a bare .execute().

make_query() must return a FRESH query builder each call, with a
deterministic order (always end the order with "id") so pages never overlap
or skip rows.
"""
from __future__ import annotations

from typing import Callable, Iterable, List

PAGE_SIZE = 1000
IN_CHUNK = 100


def fetch_all(make_query: Callable[[], object]) -> List[dict]:
    """Every row of a query, read page by page."""
    out: List[dict] = []
    start = 0
    while True:
        rows = make_query().range(start, start + PAGE_SIZE - 1).execute().data or []
        out.extend(rows)
        if len(rows) < PAGE_SIZE:
            return out
        start += PAGE_SIZE


def chunked(items: list, size: int = IN_CHUNK) -> Iterable[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def fetch_in(supabase, table: str, columns: str, column: str, ids: list, extra: Callable | None = None) -> List[dict]:
    """select <columns> from <table> where <column> in (ids): ids sent in small
    groups, each group read page by page."""
    out: List[dict] = []
    clean = list(dict.fromkeys(i for i in ids if i))
    for group in chunked(clean, IN_CHUNK):

        def make(group=group):
            q = supabase.table(table).select(columns).in_(column, group)
            if extra:
                q = extra(q)
            return q.order("id")

        out.extend(fetch_all(make))
    return out
