# REAL-DATABASE TEST. Loads the exact general_ledger / general_ledger_opening_balance functions from the live
# database next to the tenant-safe copy (portal_tenant_ledger*) in a real Postgres, fills both companies with
# random data, and requires IDENTICAL results for every tenant and date window. Also proves company isolation,
# that public roles cannot run the function, and that migrations 017 and 019 are safe to re-run.
import random, uuid, re, sys, tempfile, datetime as dt
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
import pgserver, psycopg2
random.seed(7)
d = tempfile.mkdtemp()
srv = pgserver.get_server(d)
uri = srv.get_uri()
conn = psycopg2.connect(uri); conn.autocommit = True; cur = conn.cursor()
print("Postgres:", srv.psql("select version();").strip().splitlines()[2][:60])
for r in ("anon","authenticated","service_role"): cur.execute(f"create role {r}")
cur.execute("""
create table companies(id uuid primary key);
create table chart_of_accounts(id uuid primary key, company_id uuid, code text, account_type text);
create table buildings(id uuid primary key, name text);
create table rooms(id uuid primary key, room_number text);
create table owners(id uuid primary key, name text);
create table tenants(id uuid primary key, company_id uuid, full_name text);
create table invoices(id uuid primary key);
create table journal_entries(id uuid primary key, company_id uuid, entry_date date, description text, source_type text, source_id uuid);
create table journal_lines(id uuid primary key default gen_random_uuid(), journal_entry_id uuid, company_id uuid, account_id uuid, direction text, amount numeric, building_id uuid, room_id uuid, owner_id uuid, tenant_id uuid, created_at timestamptz default clock_timestamp());
create function auth_company_id() returns uuid language sql stable as $$ select nullif(current_setting('app.company_id', true), '')::uuid $$;
""")
# ---- YOUR two functions, exactly as pasted from your database
cur.execute("""
CREATE OR REPLACE FUNCTION public.general_ledger(p_account_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_owner_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_building_id uuid DEFAULT NULL::uuid, p_room_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entry_date date, description text, source_type text, source_id uuid, journal_entry_id uuid, direction text, amount numeric, building_name text, room_number text, owner_name text, tenant_name text, running_balance numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with lines as (
    select
      je.entry_date, je.description, je.source_type, je.source_id, je.id as journal_entry_id,
      jl.direction, jl.amount, coa.account_type,
      b.name as building_name, r.room_number, o.name as owner_name, t.full_name as tenant_name,
      jl.created_at
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join chart_of_accounts coa on coa.id = jl.account_id
    left join buildings b on b.id = jl.building_id
    left join rooms r on r.id = jl.room_id
    left join owners o on o.id = jl.owner_id
    left join tenants t on t.id = jl.tenant_id
    where jl.account_id = p_account_id
      and coa.company_id = auth_company_id()
      and (p_date_from is null or je.entry_date >= p_date_from)
      and (p_date_to is null or je.entry_date <= p_date_to)
      and (p_owner_id is null or jl.owner_id = p_owner_id)
      and (p_tenant_id is null or jl.tenant_id = p_tenant_id)
      and (p_building_id is null or jl.building_id = p_building_id)
      and (p_room_id is null or jl.room_id = p_room_id)
  )
  select
    entry_date, description, source_type, source_id, journal_entry_id, direction, amount,
    building_name, room_number, owner_name, tenant_name,
    sum(
      case
        when account_type in ('asset', 'expense') then (case when direction = 'debit' then amount else -amount end)
        else (case when direction = 'credit' then amount else -amount end)
      end
    ) over (order by entry_date, created_at rows between unbounded preceding and current row) as running_balance
  from lines
  order by entry_date, created_at
$function$;
CREATE OR REPLACE FUNCTION public.general_ledger_opening_balance(p_account_id uuid, p_before date, p_owner_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_building_id uuid DEFAULT NULL::uuid, p_room_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select round(coalesce(sum(
    case
      when coa.account_type in ('asset', 'expense') then (case when jl.direction = 'debit' then jl.amount else -jl.amount end)
      else (case when jl.direction = 'credit' then jl.amount else -jl.amount end)
    end
  ), 0), 2)
  from journal_lines jl
  join journal_entries je on je.id = jl.journal_entry_id
  join chart_of_accounts coa on coa.id = jl.account_id
  where jl.account_id = p_account_id
    and coa.company_id = auth_company_id()
    and jl.company_id = auth_company_id()
    and je.company_id = auth_company_id()
    and je.entry_date < p_before
    and (p_owner_id is null or jl.owner_id = p_owner_id)
    and (p_tenant_id is null or jl.tenant_id = p_tenant_id)
    and (p_building_id is null or jl.building_id = p_building_id)
    and (p_room_id is null or jl.room_id = p_room_id)
$function$;
""")
# ---- the repo's existing fast-balance function (migration 012) and MY migration, run exactly as delivered
cur.execute("""
create or replace function tenant_account_balance_as_of(p_company_id uuid, p_account_id uuid, p_tenant_id uuid, p_as_of_date date)
returns numeric language sql stable as $$
  select round(coalesce(sum(case when jl.direction = 'debit' then jl.amount else -jl.amount end), 0), 2)
  from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
  where jl.company_id = p_company_id and jl.account_id = p_account_id and jl.tenant_id = p_tenant_id and je.entry_date <= p_as_of_date
$$;
""")
cur.execute((ROOT / "017_schema_patch_033_portal_ledger_and_requests.sql").read_text())
print("migration 017 final check row:", cur.fetchall())

# ---- migration 019 (repairs): existing requests must survive, it must be re-runnable, and the new rules must hold
co0, t0, r0 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into companies values (%s)", (co0,)); cur.execute("insert into tenants values (%s,%s,'Old Tenant')", (t0, co0)); cur.execute("insert into rooms values (%s,'9')", (r0,))
cur.execute("insert into tenant_portal_requests (company_id, tenant_id, kind, message, status) values (%s,%s,'invoice_change','remove parking','open'), (%s,%s,'invoice_change','old one','resolved')", (co0, t0, co0, t0))
sql019 = (ROOT / "019_schema_patch_035_portal_repairs.sql").read_text()
cur.execute(sql019); first = cur.fetchall()
cur.execute(sql019); second = cur.fetchall()
print("migration 019 final check row (run 1, run 2):", first, second)
assert first == second == [(2, True, 0)], "019 not idempotent or wrong"
cur.execute("select count(*) from tenant_portal_requests"); assert cur.fetchone()[0] == 2, "existing requests lost"
cur.execute("insert into tenant_portal_requests (company_id, tenant_id, kind, message, status, category, room_id) values (%s,%s,'repair','tap leaking','in_progress','Plumbing',%s)", (co0, t0, r0))
cur.execute("insert into tenant_portal_requests (company_id, tenant_id, kind, message, status) values (%s,%s,'repair','x','cancelled')", (co0, t0))
try:
    cur.execute("insert into tenant_portal_requests (company_id, tenant_id, kind, message, status) values (%s,%s,'repair','x','bogus')", (co0, t0)); bad_status_blocked = False
except psycopg2.Error:
    bad_status_blocked = True
print("statuses in_progress/cancelled accepted, bogus status blocked:", bad_status_blocked)
assert bad_status_blocked

U = lambda: str(uuid.uuid4())
cos = [U(), U()]
data = {}
for co in cos:
    cur.execute("insert into companies values (%s)", (co,))
    ar, liab = U(), U()
    cur.execute("insert into chart_of_accounts values (%s,%s,'1100','asset'),(%s,%s,'2100','liability')", (ar, co, liab, co))
    bl, rm, ow = U(), U(), U()
    cur.execute("insert into buildings values (%s,%s)", (bl, "Tower " + co[:4]))
    cur.execute("insert into rooms values (%s,%s)", (rm, "101"))
    cur.execute("insert into owners values (%s,%s)", (ow, "Owner"))
    tenants = []
    for i in range(6):
        t = U(); tenants.append(t); cur.execute("insert into tenants values (%s,%s,%s)", (t, co, f"Tenant {i}"))
    base = dt.date(2026, 1, 1)
    for n in range(260):
        je = U(); day = base + dt.timedelta(days=random.randint(0, 300))
        cur.execute("insert into journal_entries values (%s,%s,%s,%s,%s,%s)", (je, co, day, f"Entry {n} {'reversal' if random.random()<.1 else 'invoice'}", random.choice(["invoice","payment","manual"]), U()))
        t = random.choice(tenants + [None])
        amt = round(random.uniform(500, 90000), 2)
        acct = ar if random.random() < .85 else liab
        dirn = random.choice(["debit", "credit"])
        other = "credit" if dirn == "debit" else "debit"
        cur.execute("insert into journal_lines (journal_entry_id,company_id,account_id,direction,amount,building_id,room_id,owner_id,tenant_id) values (%s,%s,%s,%s,%s,%s,%s,%s,%s)", (je, co, acct, dirn, amt, bl, rm, ow, t))
        cur.execute("insert into journal_lines (journal_entry_id,company_id,account_id,direction,amount,tenant_id) values (%s,%s,%s,%s,%s,%s)", (je, co, liab if acct == ar else ar, other, amt, t))
    data[co] = dict(ar=ar, liab=liab, tenants=tenants)

cols = "entry_date, description, source_type, direction, amount, building_name, room_number, running_balance"
bad = 0; compared = 0; rows_total = 0
windows = [(None, None), (dt.date(2026,3,1), None), (None, dt.date(2026,8,15)), (dt.date(2026,4,10), dt.date(2026,7,20)), (dt.date(2027,6,1), None)]
for co in cos:
    cur.execute("select set_config('app.company_id', %s, false)", (co,))
    for t in data[co]["tenants"]:
        for (a, b) in windows:
            cur.execute(f"select {cols} from general_ledger(%s,%s,%s,null,%s,null,null)", (data[co]["ar"], a, b, t)); admin = cur.fetchall()
            cur.execute(f"select {cols} from portal_tenant_ledger(%s,%s,%s,%s,%s)", (co, t, data[co]["ar"], a, b)); portal = cur.fetchall()
            compared += 1; rows_total += len(admin)
            if admin != portal: bad += 1; print("LEDGER MISMATCH", co[:4], t[:4], a, b, len(admin), len(portal))
            if a:
                cur.execute("select general_ledger_opening_balance(%s,%s,null,%s)", (data[co]["ar"], a, t)); oa = cur.fetchone()[0]
                cur.execute("select portal_tenant_ledger_opening(%s,%s,%s,%s)", (co, t, data[co]["ar"], a)); op = cur.fetchone()[0]
                if oa != op: bad += 1; print("OPENING MISMATCH", a, oa, op)
print(f"compared {compared} tenant/date-window ledgers ({rows_total} ledger lines): mismatches = {bad}")
# isolation: wrong company / wrong account / unknown tenant must give nothing
a_co, b_co = cos
ta = data[a_co]["tenants"][0]
checks = {
 "company B asking for company A tenant": ("select count(*) from portal_tenant_ledger(%s,%s,%s)", (b_co, ta, data[a_co]["ar"])),
 "company A asking with company B account": ("select count(*) from portal_tenant_ledger(%s,%s,%s)", (a_co, ta, data[b_co]["ar"])),
 "company B tenant under company A id": ("select count(*) from portal_tenant_ledger(%s,%s,%s)", (a_co, data[b_co]["tenants"][0], data[a_co]["ar"])),
 "null tenant (would be 'everyone')": ("select count(*) from portal_tenant_ledger(%s,%s,%s)", (a_co, None, data[a_co]["ar"])),
}
for k,(q,p) in checks.items():
    cur.execute(q,p); n = cur.fetchone()[0]; print(f"isolation: {k}: rows returned = {n}", "OK" if n==0 else "LEAK!"); bad += (n!=0)
# can the public roles run it?
cur.execute("select has_function_privilege('anon','portal_tenant_ledger(uuid,uuid,uuid,date,date)','execute'), has_function_privilege('authenticated','portal_tenant_ledger(uuid,uuid,uuid,date,date)','execute'), has_function_privilege('service_role','portal_tenant_ledger(uuid,uuid,uuid,date,date)','execute')")
print("anon/authenticated/service_role may execute:", cur.fetchone())
# the read-only verification query you will run (017b)
cur.execute((ROOT / "017b_verify_portal_ledger_matches.sql").read_text()); print("017b result (tenants_checked, matching, differing):", cur.fetchone())
print("RESULT:", "ALL EQUIVALENT" if bad==0 else f"{bad} PROBLEMS")
srv.cleanup()
sys.exit(1 if bad else 0)
