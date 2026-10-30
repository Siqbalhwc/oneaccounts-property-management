# Repair requests and the shared admin inbox
# Runs with no live database: a small in-memory stand-in is used. Start it with run_all.py.
import os, copy, itertools
os.environ.update(SUPABASE_URL="https://x.supabase.co", SUPABASE_ANON_KEY="a", SUPABASE_SERVICE_ROLE_KEY="svc-secret")
import app.plugins.tenant_portal.portal_repair_router as rp
import app.plugins.tenant_portal.admin_router as ar
import app.plugins.tenant_portal.portal_router as pr
from fastapi import HTTPException
STORE={"leases":[{"id":"L1","company_id":"A","tenant_id":"t1","room_id":"R1","status":"active"},{"id":"L1b","company_id":"A","tenant_id":"t1","room_id":"R3","status":"active"},{"id":"L0","company_id":"A","tenant_id":"t1","room_id":"R0","status":"terminated"},{"id":"L2","company_id":"A","tenant_id":"t2","room_id":"R2","status":"active"},{"id":"L5","company_id":"A","tenant_id":"t5","room_id":"R5","status":"active"}],
 "rooms":[{"id":"R1","company_id":"A","room_number":"101","building":{"name":"Tower"}},{"id":"R3","company_id":"A","room_number":"303","building":{"name":"Tower"}},{"id":"R0","company_id":"A","room_number":"001","building":{"name":"Old"}},{"id":"R2","company_id":"A","room_number":"202","building":{"name":"Tower"}},{"id":"R5","company_id":"A","room_number":"505","building":{"name":"Tower"}}],
 "tenants":[{"id":"t1","company_id":"A","full_name":"Ahmed Raza"},{"id":"t2","company_id":"A","full_name":"Sara Bibi"},{"id":"t5","company_id":"A","full_name":"One Unit"}],
 "invoices":[], "tenant_portal_requests":[]}
_n=itertools.count(1)
class Q:
    def __init__(s,t): s.t=t; s.f=[]; s.op="select"; s.ord=None
    def select(s,*a,**k): return s
    def eq(s,k,v): s.f.append(lambda r:r.get(k)==v); return s
    def neq(s,k,v): s.f.append(lambda r:r.get(k)!=v); return s
    def in_(s,k,vs): s.f.append(lambda r:r.get(k) in vs); return s
    def order(s,k,desc=False): s.ord=(k,desc); return s
    def limit(s,n): return s
    def insert(s,p): s.op="insert"; s.p=p; return s
    def update(s,p): s.op="update"; s.p=p; return s
    def execute(s):
        class R: pass
        r=R(); rows=STORE[s.t]
        if s.op=="insert":
            it=dict(s.p); it.setdefault("id",f"Q{next(_n)}"); it.setdefault("status","open"); it.setdefault("admin_reply",None); it.setdefault("created_at",f"2026-10-{next(_n):02d}"); it.setdefault("room_id",None); it.setdefault("invoice_id",None); rows.append(it); r.data=[copy.deepcopy(it)]; return r
        hit=[x for x in rows if all(f(x) for f in s.f)]
        if s.op=="update":
            for x in hit: x.update(s.p)
            r.data=copy.deepcopy(hit); return r
        out=copy.deepcopy(hit)
        if s.ord: out.sort(key=lambda x:str(x[s.ord[0]]), reverse=s.ord[1])
        r.data=out; return r
class C:
    def table(s,t): return Q(t)
c=C(); rp.get_service_client=lambda:c; ar.get_service_client=lambda:c
ok=lambda l,cond: print(("PASS " if cond else "FAIL ")+l) or (cond or exit(1))
def raises(code,fn):
    try: fn(); return False
    except HTTPException as e: return e.status_code==code
PERMS={k:True for k in ["view_invoices","view_ledger","submit_payment","submit_repair","download_receipts","request_invoice_change"]}
ctx=lambda tid="t1",cid="A",perms=None:{"company_id":cid,"tenant_id":tid,"permissions":perms or PERMS,"account":{"must_change_password":False}}
R=lambda **k: rp.RepairBody(**{**dict(category="Plumbing",description="Kitchen tap is leaking badly",room_id="R1"),**k})
opt=rp.repair_options(ctx())
ok("options: fixed categories and only current (non-terminated) units of THIS tenant", "Plumbing" in opt["categories"] and len(opt["categories"])==8 and sorted(u["number"] for u in opt["units"])==["101","303"])
ok("permission off -> 403", raises(403,lambda:pr.require_permission("submit_repair")(ctx(perms={"submit_repair":False}))))
ok("repair request saved with category, unit, tenant, kind", rp.create_repair(R(),ctx())["id"] and STORE["tenant_portal_requests"][0]["kind"]=="repair" and STORE["tenant_portal_requests"][0]["room_id"]=="R1" and STORE["tenant_portal_requests"][0]["tenant_id"]=="t1" and STORE["tenant_portal_requests"][0]["category"]=="Plumbing")
ok("same request again -> 409", raises(409,lambda:rp.create_repair(R(description="kitchen tap is leaking badly"),ctx())))
ok("unknown category refused", raises(400,lambda:rp.create_repair(R(category="Hacking"),ctx())))
ok("too-short / too-long description refused", raises(400,lambda:rp.create_repair(R(description="no"),ctx())) and raises(400,lambda:rp.create_repair(R(description="x"*501),ctx())))
ok("unit from someone else's agreement -> 404", raises(404,lambda:rp.create_repair(R(room_id="R2",description="other unit problem"),ctx())))
ok("terminated agreement's unit -> 404", raises(404,lambda:rp.create_repair(R(room_id="R0",description="old unit problem"),ctx())))
ok("two units and none chosen -> 400", raises(400,lambda:rp.create_repair(R(room_id=None,description="which one?? unknown"),ctx())))
ok("single-unit tenant needs no unit choice", rp.create_repair(R(room_id=None,description="Fan not working at all"),ctx("t5"))["id"] and STORE["tenant_portal_requests"][-1]["room_id"]=="R5")
ok("tenant without any current agreement -> 400", raises(400,lambda:rp.create_repair(R(),ctx("t9"))))
for i in range(9): rp.create_repair(R(description=f"Another different issue number {i}",room_id="R3"),ctx())
ok("limit of 10 open repair requests per tenant (429)", raises(429,lambda:rp.create_repair(R(description="one more issue please"),ctx())))
mine=rp.my_repairs(ctx())["repairs"]
ok("tenant list: only own repairs, newest first, with unit label", len(mine)==10 and mine[0]["unit"]["number"] in ("101","303") and all(m["category"] for m in mine) and rp.my_repairs(ctx("t2"))["repairs"]==[])
rid=STORE["tenant_portal_requests"][0]["id"]
ok("cancel own open repair works", rp.cancel_repair(rid,ctx())["ok"] and STORE["tenant_portal_requests"][0]["status"]=="cancelled")
other=STORE["tenant_portal_requests"][1]["id"]
ok("cannot cancel someone else's repair -> 409", raises(409,lambda:rp.cancel_repair(other,ctx("t2"))))
ok("cannot cancel twice -> 409", raises(409,lambda:rp.cancel_repair(rid,ctx())))
# admin
lst=ar.list_requests("open","A")["requests"]
ok("admin inbox: repairs with tenant, category, unit; cancelled one hidden", len(lst)==10 and all(x["tenant_name"] in ("Ahmed Raza","One Unit") for x in lst) and any(x["room"]=={"number":"505","building":"Tower"} for x in lst) and all(x["status"]!="cancelled" for x in lst))
ok("company B sees none", ar.list_requests("open","B")["requests"]==[])
ar.get_service_client=lambda:c
tid=[x for x in STORE["tenant_portal_requests"] if x["status"]=="open" and x["tenant_id"]=="t1"][0]["id"]
ok("start work: open -> in_progress with a note the tenant sees", ar.start_request(tid,ar.ProgressBody(reply="Plumber coming Tuesday"),"A")["status"]=="in_progress" and [m for m in rp.my_repairs(ctx())["repairs"] if m["id"]==tid][0]["admin_reply"]=="Plumber coming Tuesday")
ok("in-progress request still shows in the admin 'open' view", tid in [x["id"] for x in ar.list_requests("open","A")["requests"]])
ok("can't start work twice -> 409", raises(409,lambda:ar.start_request(tid,ar.ProgressBody(),"A")))
ok("tenant can no longer cancel once work started -> 409", raises(409,lambda:rp.cancel_repair(tid,ctx())))
ok("mark done from in_progress works", ar.resolve_request(tid,ar.ResolveBody(status="resolved",reply="Fixed"),"A")["status"]=="resolved" and [m for m in rp.my_repairs(ctx())["repairs"] if m["id"]==tid][0]["status"]=="resolved")
ok("done request leaves the 'open' view", tid not in [x["id"] for x in ar.list_requests("open","A")["requests"]])
ok("can't resolve twice -> 409", raises(409,lambda:ar.resolve_request(tid,ar.ResolveBody(status="resolved"),"A")))
ok("other company can't touch our request -> 409", raises(409,lambda:ar.resolve_request(other,ar.ResolveBody(status="declined"),"B")) and raises(409,lambda:ar.start_request(other,ar.ProgressBody(),"B")))
STORE["tenant_portal_requests"].append({"id":"INV1","company_id":"A","tenant_id":"t1","kind":"invoice_change","invoice_id":"I1","message":"remove parking","status":"open","admin_reply":None,"created_at":"2026-11-01","room_id":None})
ok("invoice-change requests still resolve as before", ar.resolve_request("INV1",ar.ResolveBody(status="resolved",reply="done"),"A")["status"]=="resolved")
print("\nALL CHECKS PASSED")
