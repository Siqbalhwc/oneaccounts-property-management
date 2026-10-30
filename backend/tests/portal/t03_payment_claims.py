# Payment claims: validation, approval posting through the receipt code, double-approval protection, recovery, receipts
# Runs with no live database: a small in-memory stand-in is used. Start it with run_all.py.
import os, copy, itertools
os.environ.update(SUPABASE_URL="https://x.supabase.co", SUPABASE_ANON_KEY="a", SUPABASE_SERVICE_ROLE_KEY="svc-secret")
from datetime import date, timedelta, datetime, timezone
import app.plugins.tenant_portal.portal_pay_router as pp
import app.plugins.tenant_portal.admin_claims_router as ac
import app.plugins.tenant_portal.portal_router as pr
import app.routers.payments as pay
from fastapi import HTTPException
T=date.today(); iso=lambda n:(T+timedelta(days=n)).isoformat()
STORE={"leases":[{"id":"L1","company_id":"A","tenant_id":"t1"},{"id":"L1b","company_id":"A","tenant_id":"t1"},{"id":"L2","company_id":"A","tenant_id":"t2"}],
 "invoices":[
  {"id":"I1","company_id":"A","lease_id":"L1","invoice_month":"2026-09-01","total_amount":50000,"status":"sent"},
  {"id":"I2","company_id":"A","lease_id":"L1","invoice_month":"2026-10-01","total_amount":55000,"status":"draft"},
  {"id":"I3","company_id":"A","lease_id":"L1","invoice_month":"2026-08-01","total_amount":50000,"status":"paid"},
  {"id":"I4","company_id":"A","lease_id":"L1b","invoice_month":"2026-10-01","total_amount":9000,"status":"sent"},
  {"id":"IX","company_id":"A","lease_id":"L2","invoice_month":"2026-10-01","total_amount":77000,"status":"sent"}],
 "payments":[{"id":"p0","company_id":"A","tenant_id":"t1","invoice_id":"I3","amount":50000,"discount_amount":0,"receipt_group_id":"G0","payment_date":iso(-60),"payment_method":"cash","notes":None}],
 "tenants":[{"id":"t1","company_id":"A","full_name":"Ahmed Raza"},{"id":"t2","company_id":"A","full_name":"Sara Bibi"}],
 "chart_of_accounts":[{"id":"BANK","company_id":"A","code":"1000","name":"HBL","is_cash_or_bank":True},{"id":"AR","company_id":"A","code":"1100","name":"Receivable","is_cash_or_bank":False},{"id":"BANKB","company_id":"B","code":"1000","name":"Other","is_cash_or_bank":True}],
 "tenant_portal_payment_claims":[]}
_n=itertools.count(1)
class Q:
    def __init__(s,t): s.t=t; s.f=[]; s.op="select"; s.ord=None
    def select(s,*a,**k): return s
    def eq(s,k,v): s.f.append(lambda r:r.get(k)==v); return s
    def neq(s,k,v): s.f.append(lambda r:r.get(k)!=v); return s
    def in_(s,k,vs): s.f.append(lambda r:r.get(k) in vs); return s
    def ilike(s,k,pat): needle=pat.strip("%").lower(); s.f.append(lambda r:needle in (r.get(k) or "").lower()); return s
    def order(s,k,desc=False): s.ord=(k,desc); return s
    def limit(s,n): return s
    def insert(s,p): s.op="insert"; s.p=p; return s
    def update(s,p): s.op="update"; s.p=p; return s
    def execute(s):
        class R: pass
        r=R(); rows=STORE[s.t]
        if s.op=="insert":
            it=dict(s.p); it.setdefault("id",f"C{next(_n)}"); it.setdefault("status","pending"); it.setdefault("created_at",f"2026-10-{next(_n):02d}"); it.setdefault("updated_at",datetime.now(timezone.utc).isoformat()); rows.append(it); r.data=[copy.deepcopy(it)]; return r
        hit=[x for x in rows if all(f(x) for f in s.f)]
        if s.op=="update":
            for x in hit: x.update(s.p)
            r.data=copy.deepcopy(hit); return r
        out=copy.deepcopy(hit)
        if s.ord: out.sort(key=lambda x:str(x[s.ord[0]]), reverse=s.ord[1])
        r.data=out; return r
class C:
    def table(s,t): return Q(t)
c=C()
for m in (pp,ac): m.get_service_client=lambda:c
posted=[]; mode={"fail":None}
def stub_record_receipt(payload,supabase,user,company_id):
    if mode["fail"]=="http": raise HTTPException(status_code=500,detail="Could not post this receipt to the ledger. Nothing was saved -- please try again.")
    if mode["fail"]=="boom": raise RuntimeError("db down")
    posted.append(dict(payload=payload,company_id=company_id,user=user))
    g=f"G{len(posted)}"; STORE["payments"].append({"id":f"pp{len(posted)}","company_id":company_id,"tenant_id":"t1","invoice_id":payload.invoice_ids[0],"amount":payload.amount_received,"discount_amount":0,"receipt_group_id":g,"payment_date":str(payload.receipt_date),"payment_method":payload.payment_method,"notes":payload.notes})
    return {"receipt_group_id":g,"payments":[],"advance_amount":0,"journal_entry_id":"J","running_balance":0}
pay.record_receipt=stub_record_receipt
ok=lambda l,cond: print(("PASS " if cond else "FAIL ")+l) or (cond or exit(1))
def raises(code,fn):
    try: fn(); return False
    except HTTPException as e: return e.status_code==code
PERMS={k:True for k in ["view_invoices","view_ledger","submit_payment","submit_repair","download_receipts","request_invoice_change"]}
ctx=lambda tid="t1",cid="A",perms=None:{"company_id":cid,"tenant_id":tid,"permissions":perms or PERMS,"account":{"must_change_password":False}}
B=lambda **k: pp.ClaimBody(**{**dict(invoice_ids=["I1"],amount=50000,payment_method="bank_transfer",paid_to="0123-4567890",payment_date=T,reference="88123",note=None),**k})
# ---- tenant: creating claims
ok("bank claim for one invoice is saved as pending", pp.create_claim(B(),ctx())["id"] and STORE["tenant_portal_payment_claims"][0]["status"]=="pending" and STORE["tenant_portal_payment_claims"][0]["lease_id"]=="L1")
ok("same invoice again while pending -> 409", raises(409,lambda:pp.create_claim(B(reference="other"),ctx())))
ok("bank transfer needs an account number", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2"],paid_to=None),ctx())))
ok("amount above what the invoice owes -> 400", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2"],amount=99999),ctx())))
ok("zero amount refused", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2"],amount=0),ctx())))
ok("future date refused", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2"],payment_date=T+timedelta(days=2)),ctx())))
ok("very old date refused", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2"],payment_date=T-timedelta(days=400)),ctx())))
ok("already-paid invoice refused", raises(400,lambda:pp.create_claim(B(invoice_ids=["I3"]),ctx())))
ok("another tenant's invoice -> 404", raises(404,lambda:pp.create_claim(B(invoice_ids=["IX"]),ctx())))
ok("invoices from two agreements in one claim refused", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2","I4"],amount=1000),ctx())))
ok("unknown payment method refused", raises(400,lambda:pp.create_claim(B(invoice_ids=["I2"],payment_method="bitcoin"),ctx())))
ok("cash claim needs no account number; partial amount allowed", pp.create_claim(B(invoice_ids=["I2"],payment_method="cash",paid_to=None,amount=20000,reference=None),ctx())["id"])
ok("permission off -> 403", raises(403,lambda:pr.require_permission("submit_payment")(ctx(perms={"submit_payment":False}))))
ok("tenant's list shows only their own claims, with months", [x["amount"] for x in pp.my_claims(ctx())["claims"]][::-1]==[50000.0,20000.0] and pp.my_claims(ctx("t2"))["claims"]==[])
cl=STORE["tenant_portal_payment_claims"]; c1,c2=cl[0]["id"],cl[1]["id"]
ok("cancel own pending claim works; others' claim can't be cancelled", pp.cancel_claim(c2,ctx())["ok"] and raises(409,lambda:pp.cancel_claim(c1,ctx("t2"))))
ok("cancelled claim frees the invoice for a new claim", pp.create_claim(B(invoice_ids=["I2"],payment_method="cash",paid_to=None,amount=55000,reference="again"),ctx())["id"])
# ---- admin: listing and approving
u={"user_id":"U1"}; sb=object()
lst=ac.list_claims("pending","A")
ok("admin list: tenant name, invoices with live balance, only bank/cash accounts of this company", {x["tenant_name"] for x in lst["claims"]}=={"Ahmed Raza"} and [a["id"] for a in lst["accounts"]]==["BANK"] and lst["claims"][-1]["invoices"][0]["balance_now"]==50000)
ok("company B sees nothing of company A", ac.list_claims("pending","B")["claims"]==[])
A=lambda **k: ac.ApproveBody(**{**dict(account_id="BANK"),**k})
ok("approve with a non-bank account refused and claim stays pending", raises(400,lambda:ac.approve_claim(c1,A(account_id="AR"),"A",sb,u)) and STORE["tenant_portal_payment_claims"][0]["status"]=="pending" and posted==[])
ok("approve above what is owed refused, nothing posted", raises(400,lambda:ac.approve_claim(c1,A(amount=60000),"A",sb,u)) and posted==[] and STORE["tenant_portal_payment_claims"][0]["status"]=="pending")
mode["fail"]="http"; ok("receipt failure -> error shown, claim back to pending", raises(500,lambda:ac.approve_claim(c1,A(),"A",sb,u)) and STORE["tenant_portal_payment_claims"][0]["status"]=="pending")
mode["fail"]="boom"; ok("unexpected crash -> clean 500, claim back to pending", raises(500,lambda:ac.approve_claim(c1,A(),"A",sb,u)) and STORE["tenant_portal_payment_claims"][0]["status"]=="pending")
mode["fail"]=None
res=ac.approve_claim(c1,A(notes="checked statement"),"A",sb,u)
p=posted[0]["payload"]
ok("approve posts ONE receipt through record_receipt with the right data", len(posted)==1 and p.lease_id=="L1" and p.account_id=="BANK" and p.amount_received==50000 and p.invoice_ids==["I1"] and p.payment_method=="bank_transfer" and str(p.receipt_date)==str(T))
ok("receipt notes carry the claim marker, reference, paid-to and admin note", all(x in p.notes for x in ["portal-claim:"+c1,"Ref 88123","Paid to 0123-4567890","checked statement"]))
ok("posted as the approving staff member in the right company", posted[0]["user"]==u and posted[0]["company_id"]=="A")
row=STORE["tenant_portal_payment_claims"][0]
ok("claim marked approved with receipt id, reviewer and account", row["status"]=="approved" and row["receipt_group_id"]==res["receipt_group_id"] and row["reviewed_by"]=="U1" and row["approved_account_id"]=="BANK")
ok("double approval -> 409 and nothing posted twice", raises(409,lambda:ac.approve_claim(c1,A(),"A",sb,u)) and len(posted)==1)
ok("approved invoice can no longer be claimed against (already settled by receipt)", raises(400,lambda:pp.create_claim(B(),ctx())))
# amount lowered by admin
c3=[x for x in STORE["tenant_portal_payment_claims"] if x["status"]=="pending"][0]["id"]
ac.approve_claim(c3,A(amount=30000),"A",sb,u)
ok("admin can approve a lower amount than claimed", posted[1]["payload"].amount_received==30000 and [x for x in STORE["tenant_portal_payment_claims"] if x["id"]==c3][0]["approved_amount"]==30000)
# reject
pp.create_claim(B(invoice_ids=["I4"],amount=9000,reference="r9"),ctx()); c4=STORE["tenant_portal_payment_claims"][-1]["id"]
ok("reject needs a reason", raises(400,lambda:ac.reject_claim(c4,ac.RejectBody(reason=" "),"A",sb,u)))
ok("reject with reason; tenant sees it", ac.reject_claim(c4,ac.RejectBody(reason="Not received in bank"),"A",sb,u)["status"]=="rejected" and [x for x in pp.my_claims(ctx())["claims"] if x["id"]==c4][0]["reject_reason"]=="Not received in bank")
ok("rejected claim can't be approved or rejected again", raises(409,lambda:ac.approve_claim(c4,A(),"A",sb,u)) and raises(409,lambda:ac.reject_claim(c4,ac.RejectBody(reason="again"),"A",sb,u)))
ok("other company can't see/approve/reject our claim -> 404/409", raises(404,lambda:ac.approve_claim(c4,A(account_id="BANKB"),"B",sb,u)) and raises(409,lambda:ac.reject_claim(c4,ac.RejectBody(reason="zzz"),"B",sb,u)))
# stale 'processing' recovery
pp.create_claim(B(invoice_ids=["I4"],amount=4000,reference="r10"),ctx()); c5=STORE["tenant_portal_payment_claims"][-1]
c5.update(status="processing",updated_at=iso(-1)+"T00:00:00+00:00")
n=len(posted); STORE["payments"].append({"id":"zz","company_id":"A","tenant_id":"t1","invoice_id":"I4","amount":4000,"discount_amount":0,"receipt_group_id":"GZ","payment_date":iso(-1),"payment_method":"bank_transfer","notes":"Tenant portal claim [portal-claim:%s]"%c5["id"]})
ok("cut-off approval whose receipt WAS posted is completed, never posted twice", raises(409,lambda:ac.approve_claim(c5["id"],A(),"A",sb,u)) and c5["status"]=="approved" and c5["receipt_group_id"]=="GZ" and len(posted)==n)
pp.create_claim(B(invoice_ids=["I4"],amount=1000,reference="r11"),ctx()) if False else None
c6=dict(c5,id="C6X",status="processing",updated_at=iso(-1)+"T00:00:00+00:00",invoice_ids=["I4"],amount=1000); STORE["tenant_portal_payment_claims"].append(c6)
ok("cut-off approval with NO receipt posted is put back and can proceed", ac.approve_claim("C6X",A(amount=1000),"A",sb,u)["status"]=="approved" and len(posted)==n+1)
c7=dict(c5,id="C7X",status="processing",updated_at=datetime.now(timezone.utc).isoformat(),invoice_ids=["I4"],amount=1000); STORE["tenant_portal_payment_claims"].append(c7)
ok("a fresh 'processing' claim is left alone (409)", raises(409,lambda:ac.approve_claim("C7X",A(),"A",sb,u)))
# receipts
rc=pp.my_receipts(ctx())["receipts"]
ok("tenant receipts grouped by receipt, newest first, with invoice months", rc[0]["receipt_id"] in ("G1","G2","G3","GZ") and any(r["receipt_id"]=="G1" and r["amount"]==50000 and r["invoice_months"]==["2026-09-01"] for r in rc))
ok("other tenant has no receipts", pp.my_receipts(ctx("t2"))["receipts"]==[])
pp.fetch_receipt_context=lambda cl,rid:{"rid":rid}; pp.render_receipt_pdf=lambda x:b"%PDF-1.4 x"
ok("tenant can open own receipt PDF", pp.my_receipt_pdf("G1",ctx()).status_code==200)
ok("cannot open another tenant's receipt (group id) -> 404", raises(404,lambda:pp.my_receipt_pdf("G1",ctx("t2"))))
ok("cannot open a receipt that does not exist -> 404", raises(404,lambda:pp.my_receipt_pdf("nope",ctx())))
print("\nALL CHECKS PASSED")
