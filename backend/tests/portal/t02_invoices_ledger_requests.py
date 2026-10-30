# Tenant invoices, ledger shaping, invoice change requests and the admin inbox
# Runs with no live database: a small in-memory stand-in is used. Start it with run_all.py.
import os, copy
os.environ.update(SUPABASE_URL="https://x.supabase.co", SUPABASE_ANON_KEY="a", SUPABASE_SERVICE_ROLE_KEY="svc-secret")
from datetime import date, timedelta
import app.plugins.tenant_portal.service as svc
import app.plugins.tenant_portal.portal_router as pr
import app.plugins.tenant_portal.portal_data_router as pd
import app.plugins.tenant_portal.admin_router as ar
from fastapi import HTTPException
TODAY=date.today(); D=lambda n:(TODAY+timedelta(days=n)).isoformat()
STORE={"leases":[{"id":"L1","company_id":"A","tenant_id":"t1","room_id":"R1"},{"id":"L2","company_id":"A","tenant_id":"t2","room_id":"R2"},{"id":"LB","company_id":"B","tenant_id":"tb","room_id":"RB"}],
 "rooms":[{"id":"R1","company_id":"A","room_number":"101","building":{"name":"Tower"}},{"id":"R2","company_id":"A","room_number":"202","building":{"name":"Tower"}}],
 "invoices":[
  {"id":"I1","company_id":"A","lease_id":"L1","invoice_month":"2026-08-01","due_date":D(-60),"total_amount":50000,"status":"paid"},
  {"id":"I2","company_id":"A","lease_id":"L1","invoice_month":"2026-09-01","due_date":D(-20),"total_amount":50000,"status":"partial"},
  {"id":"I3","company_id":"A","lease_id":"L1","invoice_month":"2026-10-01","due_date":D(+10),"total_amount":55000,"status":"draft"},
  {"id":"I4","company_id":"A","lease_id":"L1","invoice_month":"2026-07-01","due_date":D(-90),"total_amount":9,"status":"cancelled"},
  {"id":"I5","company_id":"A","lease_id":"L1","invoice_month":"2026-06-01","due_date":D(-110),"total_amount":50000,"status":"sent"},
  {"id":"IX","company_id":"A","lease_id":"L2","invoice_month":"2026-10-01","due_date":D(5),"total_amount":77777,"status":"draft"},
  {"id":"IB","company_id":"B","lease_id":"LB","invoice_month":"2026-10-01","due_date":D(5),"total_amount":88888,"status":"draft"}],
 "invoice_line_items":[{"company_id":"A","invoice_id":"I3","label":"Rent","amount":45000},{"company_id":"A","invoice_id":"I3","label":"Parking","amount":10000}],
 "payments":[{"company_id":"A","tenant_id":"t1","invoice_id":"I1","amount":50000},{"company_id":"A","tenant_id":"t1","invoice_id":"I2","amount":20000},{"company_id":"A","tenant_id":"t2","invoice_id":"IX","amount":1}],
 "tenant_portal_requests":[], "chart_of_accounts":[{"id":"AR-A","company_id":"A","code":"1100"},{"id":"AR-B","company_id":"B","code":"1100"}]}
RPC={}
class Q:
    def __init__(s,t): s.t=t; s.f=[]; s.op="select"; s.ord=None; s.single_=False
    def select(s,*a,**k): return s
    def eq(s,k,v): s.f.append(lambda r:r.get(k)==v); return s
    def neq(s,k,v): s.f.append(lambda r:r.get(k)!=v); return s
    def in_(s,k,vs): s.f.append(lambda r:r.get(k) in vs); return s
    def order(s,k,desc=False): s.ord=(k,desc); return s
    def limit(s,n): return s
    def single(s): s.single_=True; return s
    def insert(s,p): s.op="insert"; s.p=p; return s
    def execute(s):
        class R: pass
        r=R(); rows=STORE[s.t]
        if s.op=="insert":
            it=dict(s.p); it.setdefault("status","open"); it.setdefault("admin_reply",None); it.setdefault("created_at",str(len(rows))); rows.append(it); r.data=[it]; return r
        out=[copy.deepcopy(x) for x in rows if all(f(x) for f in s.f)]
        if s.ord: out.sort(key=lambda x:x[s.ord[0]], reverse=s.ord[1])
        r.data=(out[0] if out else None) if s.single_ else out; return r
class C:
    def table(s,t): return Q(t)
    def rpc(s,name,params):
        class E:
            def execute(_):
                class R: pass
                r=R(); r.data=RPC[name](params); return r
        return E()
c=C(); pd.get_service_client=lambda:c
ok=lambda l,cond: print(("PASS " if cond else "FAIL ")+l) or (cond or exit(1))
def raises(code,fn):
    try: fn(); return False
    except HTTPException as e: return e.status_code==code
ctx=lambda tid="t1",cid="A",perms=None: {"company_id":cid,"tenant_id":tid,"permissions":perms or {k:True for k in ["view_invoices","view_ledger","submit_payment","submit_repair","download_receipts","request_invoice_change"]},"account":{"must_change_password":False}}
inv=pd._tenant_invoices(c,ctx(),24,0)
ok("tenant sees only own invoices, cancelled hidden, newest first", [i["id"] for i in inv]==["I3","I2","I1","I5"])
byid={i["id"]:i for i in inv}
ok("draft invoice is shown (posted everywhere) and Due", byid["I3"]["status"]=="due" and byid["I3"]["total"]==55000)
ok("line items listed (Rent, Parking)", [x["label"] for x in byid["I3"]["items"]]==["Rent","Parking"])
ok("paid invoice: Paid, balance 0, can't request change", byid["I1"]["status"]=="paid" and byid["I1"]["balance"]==0 and not byid["I1"]["can_request_change"])
ok("partial invoice: paid 20000, balance 30000", byid["I2"]["status"]=="partial" and byid["I2"]["paid"]==20000 and byid["I2"]["balance"]==30000)
ok("unpaid past due 'sent' invoice shows Overdue", byid["I5"]["status"]=="overdue")
ok("room label from the tenant's own lease", byid["I3"]["room"]=={"number":"101","building":"Tower"})
ok("another tenant's invoice is invisible (t2 sees only IX)", [i["id"] for i in pd._tenant_invoices(c,ctx("t2"),24,0)]==["IX"])
ok("other company's invoice never appears", "IB" not in [i["id"] for i in inv] and pd._tenant_invoices(c,ctx("t1","B"),24,0)==[])
ok("paging works", [i["id"] for i in pd._tenant_invoices(c,ctx(),2,1)]==["I2","I1"])
ok("cannot fetch another tenant's invoice (PDF/owner check) -> 404", raises(404,lambda:pd._owned_invoice(c,ctx(),"IX")))
ok("cannot fetch another company's invoice -> 404", raises(404,lambda:pd._owned_invoice(c,ctx(),"IB")))
ok("own invoice passes the owner check", pd._owned_invoice(c,ctx(),"I3")["id"]=="I3")
# change requests
B=pd.ChangeRequestBody
ok("change request on a paid invoice refused", raises(400,lambda:pd.request_invoice_change("I1",B(message="remove parking"),ctx())))
ok("too-short note refused", raises(400,lambda:pd.request_invoice_change("I3",B(message="x"),ctx())))
ok("request on someone else's invoice -> 404", raises(404,lambda:pd.request_invoice_change("IX",B(message="remove parking"),ctx())))
ok("valid change request is saved", pd.request_invoice_change("I3",B(message="  Please remove parking this month  "),ctx())["ok"] and STORE["tenant_portal_requests"][0]["message"]=="Please remove parking this month" and STORE["tenant_portal_requests"][0]["tenant_id"]=="t1")
ok("second open request for the same invoice refused (409)", raises(409,lambda:pd.request_invoice_change("I3",B(message="again please"),ctx())))
inv=pd._tenant_invoices(c,ctx(),24,0); b3={i["id"]:i for i in inv}["I3"]
ok("invoice now shows the open request and hides the button", b3["request"]["status"]=="open" and not b3["can_request_change"])
STORE["tenant_portal_requests"][0].update(status="resolved",admin_reply="Done, parking removed")
b3={i["id"]:i for i in pd._tenant_invoices(c,ctx(),24,0)}["I3"]
ok("tenant sees the office reply once resolved", b3["request"]["reply"]=="Done, parking removed" and b3["can_request_change"])
# permission gate
gate=pr.require_permission("request_invoice_change")
ok("permission off -> 403", raises(403,lambda:gate(ctx(perms={"request_invoice_change":False}))))
ok("permission on -> allowed", gate(ctx())["tenant_id"]=="t1")
# ledger: opening-balance logic mirrors admin
calls=[]
RPC["portal_tenant_ledger"]=lambda p:(calls.append(("led",p)) or [
 {"entry_date":"2026-10-01","description":"Rent invoice","direction":"debit","amount":50000,"running_balance":50000},
 {"entry_date":"2026-10-05","description":"Receipt","direction":"credit","amount":20000,"running_balance":30000}])
RPC["portal_tenant_ledger_opening"]=lambda p:(calls.append(("open",p)) or 12000)
led=pd.tenant_ledger(c,"A","t1",None,None)
ok("no date filter: no opening row, closing = last running balance", len(led["rows"])==2 and led["closing_balance"]==30000 and not any(r["is_opening"] for r in led["rows"]))
ok("debit/credit split into columns", led["rows"][0]["debit"]==50000 and led["rows"][0]["credit"]==0 and led["rows"][1]["credit"]==20000)
led=pd.tenant_ledger(c,"A","t1",date(2026,10,1),None)
ok("date filter: opening row inserted the day before, balances shifted by opening", led["rows"][0]["is_opening"] and led["rows"][0]["date"]=="2026-09-30" and led["rows"][0]["balance"]==12000 and led["rows"][1]["balance"]==62000 and led["closing_balance"]==42000)
ok("RPC calls carry the token's company and tenant (not request input)", all(p["p_company_id"]=="A" and p["p_tenant_id"]=="t1" for _,p in calls) and calls[-1][1]["p_account_id"]=="AR-A")
RPC["portal_tenant_ledger"]=lambda p:[]; RPC["portal_tenant_ledger_opening"]=lambda p:0
ok("empty ledger gives zero closing", pd.tenant_ledger(c,"A","t1",None,None)=={"rows":[],"closing_balance":0.0})
ok("company with no receivable account -> clean 503, not a crash", raises(503,lambda:pd.tenant_ledger(c,"Z","t1",None,None)))
ok("summary counts unpaid and overdue", (lambda s:(s["unpaid_count"],s["overdue_count"]))(pd.my_summary(ctx()))==(3,1))
ok("summary hides ledger balance when permission is off", pd.my_summary(ctx(perms={"view_ledger":False,"view_invoices":True}))["balance"] is None)
# admin side
ar.get_service_client=lambda:c
STORE["tenants"]=[{"id":"t1","company_id":"A","full_name":"Ahmed Raza"}]; STORE["tenant_portal_requests"].append({"id":"RQ2","company_id":"A","tenant_id":"t1","kind":"invoice_change","invoice_id":"I3","message":"x","status":"open","created_at":"9"})
lst=ar.list_requests("open","A")["requests"]
ok("admin inbox lists open requests with tenant name and invoice", len(lst)==1 and lst[0]["tenant_name"]=="Ahmed Raza" and lst[0]["invoice"]["total_amount"]==55000)
ok("admin inbox never lists another company's requests", ar.list_requests("open","B")["requests"]==[])
print("\nALL CHECKS PASSED")
