# STATIC GUARD. Reads the portal's source code and migrations and fails if an isolation rule is broken.
# It needs no database. It exists so a future change that forgets a company filter is caught immediately.
import ast, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PLUGIN = ROOT / "backend" / "app" / "plugins" / "tenant_portal"
TENANT_FACING = ["portal_router.py", "portal_data_router.py", "portal_pay_router.py", "portal_repair_router.py"]
FORBIDDEN_PARAMS = {"company_id", "tenant_id", "account_id"}
failures = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + ("" if ok else f"  <-- {detail}"))
    if not ok:
        failures.append(label)


# 1. every database statement is locked to a company
unlocked, total = [], 0
for f in sorted(PLUGIN.glob("*.py")):
    src = f.read_text()
    lines = src.split("\n")
    for m in re.finditer(r"\.table\(([^)]*)\)", src):
        end = src.find(".execute()", m.start())
        stmt = src[m.start(): (end if end != -1 else src.find("\n", m.start())) + 10]
        total += 1
        line_no = src.count("\n", 0, m.start()) + 1
        in_chain = re.search(r'\.eq\(\s*"company_id"', stmt) is not None or re.search(r'"company_id"\s*:', stmt) is not None
        is_company_row = m.group(1).strip() == '"companies"' and '.eq("id"' in stmt
        # The ONE allowed exception: finding a company BY its public portal code (sign-in step 1, and the
        # platform-wide uniqueness check for new codes). It reads nothing but the company id.
        is_code_lookup = re.search(r'\.eq\(\s*"portal_code"', stmt) is not None and '.select("company_id")' in stmt
        is_insert = ".insert(" in stmt
        row_has_company = is_insert and any('"company_id":' in l for l in lines[max(0, line_no - 60): line_no])
        if not (in_chain or is_company_row or row_has_company or is_code_lookup):
            unlocked.append(f"{f.name}:{line_no}")
check(f"all {total} database statements in the portal are locked to a company", not unlocked, ", ".join(unlocked))

# 2. the tenant-safe ledger functions are always called with the company AND the tenant (read from the code's structure)
rpc_bad, rpc_seen = [], 0
for f in sorted(PLUGIN.glob("*.py")):
    for node in ast.walk(ast.parse(f.read_text())):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "rpc" and node.args \
                and isinstance(node.args[0], ast.Constant) and str(node.args[0].value).startswith("portal_"):
            rpc_seen += 1
            keys = {k.value for k in node.args[1].keys if isinstance(k, ast.Constant)} if len(node.args) > 1 and isinstance(node.args[1], ast.Dict) else set()
            if not {"p_company_id", "p_tenant_id"} <= keys:
                rpc_bad.append(f"{f.name}:{node.lineno}")
check(f"all {rpc_seen} tenant-ledger function calls carry both the company and the tenant", rpc_seen > 0 and not rpc_bad, ", ".join(rpc_bad) or "no calls found")

# 3. tenants can never choose their company / tenant: no such parameter on any tenant-facing route
param_bad, model_bad = [], []
for name in TENANT_FACING:
    tree = ast.parse((PLUGIN / name).read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            is_route = any(isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and isinstance(d.func.value, ast.Name) and d.func.value.id == "router" for d in node.decorator_list)
            if is_route:
                bad = {a.arg for a in node.args.args + node.args.kwonlyargs} & FORBIDDEN_PARAMS
                if bad:
                    param_bad.append(f"{name}:{node.name}({', '.join(sorted(bad))})")
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name) and item.target.id in FORBIDDEN_PARAMS:
                    model_bad.append(f"{name}:{node.name}.{item.target.id}")
check("no tenant-facing route accepts a company, tenant or account id from the browser", not param_bad, ", ".join(param_bad))
check("no tenant-facing request body can carry a company, tenant or account id", not model_bad, ", ".join(model_bad))

# 4. tenant routes are registered WITHOUT the staff guard, staff routes WITH it (and nothing mixed up)
init = (PLUGIN / "__init__.py").read_text()
for r in ("admin_router", "admin_claims_router"):
    check(f"{r} is registered behind the staff access guard", re.search(rf"include_router\({r},[^)]*dependencies=guard", init) is not None)
for r in ("portal_router", "portal_data_router", "portal_pay_router", "portal_repair_router"):
    check(f"{r} (tenants) is NOT behind the staff guard", re.search(rf"include_router\({r},", init) is not None and re.search(rf"include_router\({r},[^)]*dependencies", init) is None)

# 5. database rules for every portal table: row security ON, no policies, no public access to the ledger function
sql = "\n".join(p.read_text() for p in sorted(ROOT.glob("0*.sql")))
tables = sorted(set(re.findall(r"create table if not exists (tenant_portal_[a-z_]+)", sql)))
check("the portal has its tables defined in migrations", len(tables) >= 4, str(tables))
for t in tables:
    check(f"{t}: row level security is enabled", re.search(rf"alter table {t} enable row level security", sql) is not None)
    check(f"{t}: has NO access policies (backend-only)", re.search(rf"create policy[^;]*\bon\s+{t}\b", sql, re.I) is None)
check("tenant-ledger functions are not executable by anon/authenticated users",
      re.search(r"grant\s+execute\s+on\s+function\s+portal_tenant_ledger[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b", sql, re.I) is None
      and "revoke all on function portal_tenant_ledger(uuid, uuid, uuid, date, date) from public, anon, authenticated" in sql)
no_cascade = [t for t in tables if not re.search(rf"create table if not exists {t}\s*\([^;]*company_id uuid (?:not null|primary key) references companies\(id\) on delete cascade", sql, re.S)]
check("every portal table is removed together with its company (cascade)", not no_cascade, ", ".join(no_cascade))

print(f"\n{'ALL CHECKS PASSED' if not failures else str(len(failures)) + ' PROBLEMS'}")
sys.exit(1 if failures else 0)
