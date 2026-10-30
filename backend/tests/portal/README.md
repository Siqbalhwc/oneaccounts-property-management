# Tenant Portal tests

These tests protect the portal's most important promise: **one company's data is never visible to another
company, and a tenant only ever sees their own.** They run on a developer machine or automatically on GitHub.
They never run on your live site, so they cost nothing in speed.

Run them all:

    pip install -r backend/requirements.txt pgserver psycopg2-binary
    python backend/tests/portal/run_all.py

| File | What it proves |
|---|---|
| `guard_isolation.py` | Reads the code: every database statement is locked to a company, tenants can't pass a company/tenant id, staff and tenant routes are guarded correctly, portal tables are backend-only. |
| `t01`..`t06` | The portal logic against an in-memory stand-in database: logins, invoices, ledger, payment approval, repairs, sign-in page, and two companies sharing the same CNIC. |
| `pg_ledger_equivalence.py` | In a real Postgres: the tenant ledger returns IDENTICAL results to the admin ledger, never leaks across companies, and migrations are re-runnable. |
| `pg_cnic_isolation.py` | In a real Postgres: the same CNIC can exist in different companies, never twice in one. |

If you add a new portal feature, add its checks here. If `guard_isolation.py` fails, a company filter has
been forgotten: fix the code, not the test.
