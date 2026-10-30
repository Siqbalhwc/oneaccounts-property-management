# Same CNIC in two companies: separate logins, no crossing over
# Runs with no live database: a small in-memory stand-in is used. Start it with run_all.py.
import os, copy
os.environ.update(SUPABASE_URL="https://x.supabase.co", SUPABASE_ANON_KEY="a", SUPABASE_SERVICE_ROLE_KEY="svc-secret")
from datetime import datetime, timezone, timedelta
import app.plugins.tenant_portal.service as svc
import app.plugins.tenant_portal.portal_router as pr
import app.plugins.tenant_portal.admin_router as ar
import app.plugins.tenant_portal.handlers as hd
from app.plugins.tenant_portal import security as sec
from app.core import hooks
from fastapi import HTTPException

STORE = {"companies":[{"id":"A","name":"Alpha Estates","status":"active","logo_url":None,"unit_type":"shop"},{"id":"B","name":"Beta Properties","status":"active","logo_url":None,"unit_type":"apartment"}],
 "tenants":[], "tenant_portal_accounts":[], "tenant_portal_settings":[], "company_feature_flags":[], "leases":[], "invoices":[], "invoice_line_items":[], "payments":[], "rooms":[], "tenant_portal_requests":[]}
class Q:
    def __init__(s,t,st): s.t=t; s.st=st; s.f=[]; s.op="select"; s.payload=None; s.cols="*"
    def select(s,cols="*",**k): s.cols=cols; return s
    def eq(s,k,v): s.f.append(lambda r:r.get(k)==v); return s
    def neq(s,k,v): s.f.append(lambda r:r.get(k)!=v); return s
    def in_(s,k,vs): s.f.append(lambda r:r.get(k) in vs); return s
    def order(s,*a,**k): return s
    def range(s,a,b): s.lo,s.hi=a,b; return s
    def limit(s,n): return s
    def insert(s,p): s.op="insert"; s.payload=p; return s
    def update(s,p): s.op="update"; s.payload=p; return s
    def execute(s):
        rows=STORE[s.t]; m=lambda r:all(f(r) for f in s.f)
        class R: pass
        r=R()
        if s.op=="insert":
            items=s.payload if isinstance(s.payload,list) else [s.payload]; out=[]
            for it in items:
                it=dict(it)
                if s.t=="tenant_portal_accounts":
                    if any(x["tenant_id"]==it["tenant_id"] for x in rows) or any(x["company_id"]==it["company_id"] and x["username"]==it["username"] and x["status"]!="archived" for x in rows): raise Exception("duplicate key")
                    it.setdefault("password_hash","temp"); it.setdefault("temp_counter",1); it.setdefault("must_change_password",True); it.setdefault("token_version",1); it.setdefault("status","active"); it.setdefault("failed_attempts",0); it.setdefault("locked_until",None); it.setdefault("permission_overrides",{}); it.setdefault("last_login_at",None)
                if s.t=="tenant_portal_settings" and any(x["portal_code"]==it["portal_code"] for x in rows): raise Exception("dup code")
                rows.append(it); out.append(copy.deepcopy(it))
            r.data=out; return r
        if s.op=="update":
            out=[]
            for x in rows:
                if m(x): x.update(s.payload); out.append(copy.deepcopy(x))
            r.data=out; return r
        out=[]
        for x in rows:
            if m(x):
                y=copy.deepcopy(x)
                if "tenant:tenants" in s.cols:
                    y["tenant"]=next((copy.deepcopy(t) for t in STORE["tenants"] if t["id"]==x["tenant_id"]),None)
                    y["company"]=next((copy.deepcopy(c) for c in STORE["companies"] if c["id"]==x["company_id"]),None)
                out.append(y)
        r.data=out; return r
class C:
    def table(s,t): return Q(t,STORE)
client=C()
svc.get_service_client=lambda: client; pr.get_service_client=lambda: client; ar.get_service_client=lambda: client
svc.fetch_all=lambda f: f().execute().data
svc._cache.clear()
hd.register_handlers()

import app.plugins.tenant_portal.portal_data_router as pd
pd.get_service_client=lambda: client
def T(id,co,cnic,name,**k): return dict(id=id,company_id=co,cnic=cnic,full_name=name,phone="03001234567",owner_id=None,is_archived=False,**k)
ok=lambda label,cond: print(("PASS " if cond else "FAIL ")+label) or (cond or exit(1))
def raises(code,fn):
    try: fn(); return False
    except HTTPException as e: return e.status_code==code
CN="35202-1234567-1"
for co in ("A","B"):
    STORE["company_feature_flags"].append({"company_id":co,"feature_key":"tenant_portal","enabled":True})
svc._cache.clear()
STORE["tenants"]+= [T("tA","A",CN,"Ahmed in Alpha"), T("tB","B",CN,"Ahmed in Beta")]
for t in STORE["tenants"]: hooks.emit("tenants.created",row=t,company_id=t["company_id"])
accs={a["company_id"]:a for a in STORE["tenant_portal_accounts"]}
ok("both companies got their OWN login for the same CNIC", len(accs)==2 and accs["A"]["username"]==accs["B"]["username"]=="3520212345671" and accs["A"]["id"]!=accs["B"]["id"])
codeA,codeB=svc.get_settings("A")["portal_code"],svc.get_settings("B")["portal_code"]
ok("each company has its own portal code", codeA=="alpha-estates" and codeB=="beta-properties")
pwA,pwB=sec.temp_password(accs["A"]["id"],1),sec.temp_password(accs["B"]["id"],1)
ok("the two temporary passwords are different", pwA!=pwB)
L=lambda code,pw,user=CN: pr.login(pr.LoginBody(portal_code=code,username=user,password=pw))
ok("Alpha login works with Alpha's password", "token" in L(codeA,pwA))
ok("Beta login works with Beta's password", "token" in L(codeB,pwB))
ok("Alpha's door does NOT open with Beta's password", raises(401,lambda:L(codeA,pwB)))
ok("Beta's door does NOT open with Alpha's password", raises(401,lambda:L(codeB,pwA)))
tokA=L(codeA,pwA)["token"]; tokB=L(codeB,pwB)["token"]
cA=pr._auth("Bearer "+tokA); cB=pr._auth("Bearer "+tokB)
ok("a token only ever resolves to its own company and its own tenant", (cA["company_id"],cA["tenant_id"])==("A","tA") and (cB["company_id"],cB["tenant_id"])==("B","tB") and cA["company"]["name"]=="Alpha Estates")
# data separation: same CNIC, same shape of data, different companies
STORE["rooms"]+= [{"id":"RA","company_id":"A","room_number":"1","building":{"name":"Alpha Tower"}},{"id":"RB","company_id":"B","room_number":"1","building":{"name":"Beta Tower"}}]
STORE["leases"]+= [{"id":"LA","company_id":"A","tenant_id":"tA","room_id":"RA","status":"active"},{"id":"LB","company_id":"B","tenant_id":"tB","room_id":"RB","status":"active"}]
STORE["invoices"]+= [{"id":"IA","company_id":"A","lease_id":"LA","invoice_month":"2026-10-01","due_date":"2026-11-01","total_amount":1000,"status":"sent"},{"id":"IB","company_id":"B","lease_id":"LB","invoice_month":"2026-10-01","due_date":"2026-11-01","total_amount":9999,"status":"sent"}]
for c in (cA,cB): c["permissions"]={k:True for k in ["view_invoices","view_ledger","submit_payment","submit_repair","download_receipts","request_invoice_change"]}
ok("Alpha's tenant sees ONLY Alpha's invoice", [i["id"] for i in pd._tenant_invoices(client,cA,24,0)]==["IA"])
ok("Beta's tenant sees ONLY Beta's invoice", [i["id"] for i in pd._tenant_invoices(client,cB,24,0)]==["IB"])
ok("Alpha's tenant cannot open Beta's invoice by guessing its id", raises(404,lambda:pd._owned_invoice(client,cA,"IB")))
ok("Alpha's tenant cannot ask for a change on Beta's invoice", raises(404,lambda:pd.request_invoice_change("IB",pd.ChangeRequestBody(message="remove it please"),cA)))
forged={**cA,"tenant_id":"tB"}
ok("even a forged mix (Alpha company + Beta tenant) finds nothing", pd._tenant_invoices(client,forged,24,0)==[])
forged2={**cA,"company_id":"B"}
ok("even a forged mix (Beta company + Alpha tenant) finds nothing", pd._tenant_invoices(client,forged2,24,0)==[])
seen=[]
pd.get_account_id=lambda c,co,code:"AR-"+co
client_rpc=client.rpc if hasattr(client,"rpc") else None
class RC:
    def __init__(s,real): s.real=real
    def table(s,t): return s.real.table(t)
    def rpc(s,name,params):
        seen.append(params)
        class E:
            def execute(_):
                class R: pass
                r=R(); r.data=[]; return r
        return E()
pd.tenant_ledger(RC(client),cA["company_id"],cA["tenant_id"],None,None)
ok("Alpha's ledger query is stamped with Alpha + Alpha's tenant only (from the token)", seen[-1]["p_company_id"]=="A" and seen[-1]["p_tenant_id"]=="tA" and seen[-1]["p_account_id"]=="AR-A")
# a token whose claims don't match the account is useless
badtok=sec.issue_token({**accs["B"],"company_id":"A"},8)
ok("a token claiming the wrong company for an account is rejected", raises(401,lambda:pr._auth("Bearer "+badtok)))
# independence of passwords / sessions / archive / switches
newB=pr.change_password(pr.ChangePasswordBody(current_password=pwB,new_password="Beta-own-pass-1"),pr._auth("Bearer "+tokB))
ok("Beta's tenant sets their own password...", "token" in newB)
ok("...Alpha's login is unaffected (still on its temporary password)", STORE["tenant_portal_accounts"][[a["id"] for a in STORE["tenant_portal_accounts"]].index(accs["A"]["id"])]["must_change_password"] is True and "token" in L(codeA,pwA))
hooks.emit("tenants.archived",row=STORE["tenants"][0],company_id="A")
ok("archiving the tenant in Alpha locks only Alpha's login", raises(401,lambda:L(codeA,pwA)) and "token" in L(codeB,"Beta-own-pass-1"))
STORE["company_feature_flags"][1]["enabled"]=False; svc._cache.clear()
ok("switching the plug-in off for Beta cuts only Beta", raises(403,lambda:L(codeB,"Beta-own-pass-1")))
STORE["company_feature_flags"][1]["enabled"]=True; svc._cache.clear(); STORE["companies"][1]["status"]="suspended"
ok("suspending Beta blocks only Beta", raises(403,lambda:L(codeB,"Beta-own-pass-1")))
STORE["companies"][1]["status"]="active"
# duplicate CNIC INSIDE one company
hooks.emit("tenants.unarchived",row=STORE["tenants"][0],company_id="A")   # Alpha's first tenant is active again
ok("(setup) Alpha's first tenant has an active login again", [a for a in STORE["tenant_portal_accounts"] if a["tenant_id"]=="tA"][0]["status"]=="active")
STORE["tenants"].append(T("tA3","A","35202 1234567 1","Another Ahmed in Alpha"))
res=svc.create_accounts("A",[STORE["tenants"][-1]],client)
ok("a second tenant with the same CNIC inside the same company is NOT given a clashing login", res["created"]==[] and len(res["skipped"])==1 and "already uses this CNIC" in res["skipped"][0]["reason"])
ok("...and the first tenant's login is untouched", [a for a in STORE["tenant_portal_accounts"] if a["username"]=="3520212345671" and a["company_id"]=="A" and a["status"]=="active"].__len__()==1)
print("\nALL CHECKS PASSED")
