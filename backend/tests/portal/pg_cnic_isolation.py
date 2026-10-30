# REAL-DATABASE TEST. The same CNIC in two companies, and the uniqueness rules that protect it.
import uuid, tempfile, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
import pgserver, psycopg2
srv = pgserver.get_server(tempfile.mkdtemp()); conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True; cur = conn.cursor()
cur.execute("create table companies(id uuid primary key); create table tenants(id uuid primary key, company_id uuid, cnic text);")
cur.execute((ROOT / "016_schema_patch_032_tenant_portal.sql").read_text())
U=lambda: str(uuid.uuid4())
A,B=U(),U(); cur.execute("insert into companies values (%s),(%s)",(A,B))
tA,tB,tA2=U(),U(),U()
for t,co in ((tA,A),(tB,B),(tA2,A)): cur.execute("insert into tenants values (%s,%s,'35202-1234567-1')",(t,co))
CN="3520212345671"
def ins(co,t,status="active"):
    cur.execute("insert into tenant_portal_accounts (company_id,tenant_id,username,status) values (%s,%s,%s,%s)",(co,t,CN,status))
def blocked(fn):
    try: fn(); return False
    except psycopg2.errors.UniqueViolation: return True
ok=lambda l,c: print(("PASS " if c else "FAIL ")+l) or (c or sys.exit(1))
ins(A,tA); ins(B,tB)
ok("the SAME CNIC can hold a login in company A and in company B (two separate accounts)", True)
cur.execute("select count(distinct company_id), count(*) from tenant_portal_accounts where username=%s",(CN,)); ok("two accounts exist, one per company", cur.fetchone()==(2,2))
ok("a second ACTIVE login with that CNIC inside company A is refused by the database", blocked(lambda: ins(A,tA2)))
cur.execute("update tenant_portal_accounts set status='archived' where tenant_id=%s",(tA,))
ins(A,tA2); ok("after company A archives the old tenant, a new tenant with the same CNIC can get a login", True)
ok("one tenant can never have two logins", blocked(lambda: ins(B,tB)))
cur.execute("select company_id from tenant_portal_accounts where tenant_id=%s",(tB,)); ok("company B's login is untouched by what happened in company A", cur.fetchone()[0]==B)
cur.execute("insert into tenant_portal_settings (company_id,portal_code) values (%s,'alpha-co')",(A,))
ok("each company's portal code is unique across the whole platform", blocked(lambda: cur.execute("insert into tenant_portal_settings (company_id,portal_code) values (%s,'alpha-co')",(B,))))
srv.cleanup()
