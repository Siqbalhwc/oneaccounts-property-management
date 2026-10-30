"""
Runs every Tenant Portal test and prints one summary. Exit code 0 = everything passed.

    python backend/tests/portal/run_all.py

  * Fast tests (no database needed) always run.
  * The two real-database tests need:  pip install pgserver psycopg2-binary
    If those are missing they are SKIPPED with a clear message, unless REQUIRE_PG=1 is set
    (the automatic GitHub check sets it, so it can never silently skip them).
"""
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BACKEND = ROOT / "backend"
REQUIRE_PG = os.environ.get("REQUIRE_PG") == "1"

try:
    import pgserver  # noqa: F401
    import psycopg2  # noqa: F401
    HAVE_PG = True
except Exception:
    HAVE_PG = False

PLAN = [("static", "guard_isolation.py", False)] + [("app", p.name, False) for p in sorted(HERE.glob("t0*.py"))] + [
    ("db", "pg_ledger_equivalence.py", True), ("db", "pg_cnic_isolation.py", True)]

env = dict(os.environ, PYTHONPATH=str(BACKEND), SUPABASE_URL="https://example.supabase.co", SUPABASE_ANON_KEY="x", SUPABASE_SERVICE_ROLE_KEY="svc-secret", SUPABASE_JWT_SECRET="jwt-secret")
rows, bad = [], 0
for kind, name, needs_pg in PLAN:
    if needs_pg and not HAVE_PG:
        if REQUIRE_PG:
            rows.append((name, "FAILED", "pgserver/psycopg2 missing but REQUIRE_PG=1")); bad += 1
        else:
            rows.append((name, "SKIPPED", "install pgserver + psycopg2-binary to run this one"))
        continue
    t0 = time.time()
    r = subprocess.run([sys.executable, str(HERE / name)], cwd=str(BACKEND if kind == "app" else ROOT), env=env, capture_output=True, text=True)
    out = r.stdout
    passed, failed, skipped = out.count("\nPASS ") + (1 if out.startswith("PASS ") else 0), out.count("\nFAIL ") + (1 if out.startswith("FAIL ") else 0), out.count("SKIP ")
    ok = r.returncode == 0 and failed == 0
    if not ok:
        bad += 1
        print(f"----- output of {name} -----\n{out[-3000:]}\n{r.stderr[-1500:]}\n----------------------------")
    result_line = next((l.strip() for l in out.splitlines() if l.startswith("RESULT:")), None)
    note = (result_line or f"{passed} checks passed") + (f", {skipped} skipped" if skipped else "") + f" ({time.time() - t0:.0f}s)"
    rows.append((name, "OK" if ok else "FAILED", note if ok else f"{failed} failed, return code {r.returncode}"))

print("\nTenant Portal test summary")
print("-" * 78)
for n, s, d in rows:
    print(f"{s:<8} {n:<38} {d}")
print("-" * 78)
print("ALL GOOD" if bad == 0 else f"{bad} PROBLEM(S) - do not release until fixed")
sys.exit(1 if bad else 0)
