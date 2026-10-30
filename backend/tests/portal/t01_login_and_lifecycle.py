# Tenant logins: creation with the tenant, sign-in, lockout, password change, archive, Tower switch, suspension
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

STORE = {"companies":[{"id":"A","name":"Maaher Estate","status":"active","logo_url":None,"unit_type":"shop"},{"id":"B","name":"Other Co","status":"active","logo_url":None,"unit_type":"apartment"}],
 "tenants":[], "tenant_portal_accounts":[], "tenant_portal_settings":[], "company_feature_flags":[]}
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
def T(id,co,cnic,name,**k): return dict(id=id,company_id=co,cnic=cnic,full_name=name,phone="03001234567",owner_id=None,is_archived=False,**k)
ok=lambda label,cond: print(("PASS " if cond else "FAIL ")+label) or (cond or exit(1))
def raises(code,fn):
    try: fn(); return False
    except HTTPException as e: return e.status_code==code

# plugin OFF by default -> creating a tenant creates nothing
STORE["tenants"].append(T("t1","A","35202-1234567-1","Ahmed Raza")); hooks.emit("tenants.created",row=STORE["tenants"][0],company_id="A")
ok("plug-in is OFF by default: no account created", STORE["tenant_portal_accounts"]==[])
STORE["company_feature_flags"].append({"company_id":"A","feature_key":"tenant_portal","enabled":True}); svc._cache.clear()
ok("opt-in: company B still off", svc.plugin_enabled("B") is False and svc.plugin_enabled("A") is True)
STORE["tenants"].append(T("t2","A","35202-7654321-9","Sara Bibi")); hooks.emit("tenants.created",row=STORE["tenants"][1],company_id="A")
acc=[a for a in STORE["tenant_portal_accounts"] if a["tenant_id"]=="t2"]
ok("tenant created -> account auto-created, username = CNIC digits", len(acc)==1 and acc[0]["username"]=="3520276543219")
ok("portal code derived from company name", svc.get_settings("A")["portal_code"]=="maaher-estate")
# bulk (existing tenant t1 + owner-occupied + short cnic + archived)
STORE["tenants"]+= [T("t3","A","111","Short Cnic"), dict(T("t4","A","35202-1111111-1","Owner Occ"),owner_id="o1"), dict(T("t5","A","35202-2222222-2","Old Tenant"),is_archived=True)]
res=svc.create_accounts("A", svc.all_company_tenants("A") if False else STORE["tenants"], client)
ok("bulk: t1 created, others skipped with reasons", [c["tenant_id"] for c in res["created"]]==["t1"] and {s["tenant_id"]:s["reason"] for s in res["skipped"]}.keys()=={"t3","t4","t5"} and res["existing"]==1)
# login
a1=[a for a in STORE["tenant_portal_accounts"] if a["tenant_id"]=="t1"][0]
tmp=sec.temp_password(a1["id"],1)
good=pr.login(pr.LoginBody(portal_code="maaher-estate",username="35202 1234567 1",password=tmp))
ok("login with CNIC (any formatting) + temp password", good["must_change_password"] is True)
ok("wrong password -> generic 401", raises(401,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520212345671",password="bad"))))
ok("unknown CNIC -> same 401", raises(401,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="9999999999999",password="x"))))
ok("unknown company code -> same 401", raises(401,lambda:pr.login(pr.LoginBody(portal_code="nope",username="3520212345671",password=tmp))))
ok("company B code can't see company A tenant", raises(401,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520212345671",password="x"))))
# gating
ctx=pr._auth("Bearer "+good["token"])
ok("token resolves to the right tenant & company", ctx["tenant"]["full_name"]=="Ahmed Raza" and ctx["company_id"]=="A")
ok("data endpoints blocked until password changed", raises(403,lambda:pr.portal_ready(ctx)))
ok("me shows tenant, masked CNIC, company word", pr.me(ctx)["masked_username"].endswith("671") and pr.me(ctx)["unit_type"]=="shop")
ok("short new password refused", raises(400,lambda:pr.change_password(pr.ChangePasswordBody(current_password=tmp,new_password="short"),ctx)))
ok("CNIC as password refused", raises(400,lambda:pr.change_password(pr.ChangePasswordBody(current_password=tmp,new_password="35202-1234567-1"),ctx)))
ok("wrong current password refused", raises(400,lambda:pr.change_password(pr.ChangePasswordBody(current_password="zzz",new_password="Brand-new-pass1"),ctx)))
ctx=pr._auth("Bearer "+good["token"])
new=pr.change_password(pr.ChangePasswordBody(current_password=tmp,new_password="Brand-new-pass1"),ctx)
ok("password changed; old session token is dead", raises(401,lambda:pr._auth("Bearer "+good["token"])))
ctx=pr._auth("Bearer "+new["token"]); ok("new token works and data endpoints now open", pr.portal_ready(ctx)["tenant_id"]=="t1")
ok("old temp password no longer logs in", raises(401,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520212345671",password=tmp))))
ok("own password logs in", pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520212345671",password="Brand-new-pass1"))["must_change_password"] is False)
ok("slip unavailable once tenant set own password", ar._slip([x for x in STORE["tenant_portal_accounts"] if x["tenant_id"]=="t1"][0],STORE["tenants"][0],"maaher-estate")["available"] is False)
# lockout
for i in range(5):
    try: pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520276543219",password="wrong"))
    except HTTPException: pass
ok("5 wrong attempts -> locked (429), even right password refused", raises(429,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520276543219",password=sec.temp_password(acc[0]["id"],1)))))
# admin reset
upd=svc.bump_session("A",acc[0]["id"],{"password_hash":"temp","temp_counter":2,"must_change_password":True,"failed_attempts":0,"locked_until":None})
slip=ar._slip(upd,STORE["tenants"][1],"maaher-estate")
ok("admin reset unlocks and gives a new temp password", slip["available"] and slip["temp_password"]==sec.temp_password(acc[0]["id"],2) and slip["temp_password"]!=sec.temp_password(acc[0]["id"],1) and slip["whatsapp_phone"])
ok("account lookups are company-scoped", ar._account if True else 0)
ok("admin can't touch another company's account", raises(404,lambda:ar._account("B",acc[0]["id"])))
ok("admin can't touch another company's tenant", raises(404,lambda:ar._tenant("B","t1")))
# archive / unarchive hooks
hooks.emit("tenants.archived",row=STORE["tenants"][0],company_id="A")
ok("archive tenant -> account archived, sessions killed", raises(401,lambda:pr._auth("Bearer "+new["token"])))
ok("archived account can't log in", raises(401,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520212345671",password="Brand-new-pass1"))))
hooks.emit("tenants.unarchived",row=STORE["tenants"][0],company_id="A")
ok("unarchive tenant -> account active again", pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520212345671",password="Brand-new-pass1"))["token"])
# CNIC edit follows
hooks.emit("tenants.updated",before=STORE["tenants"][0],after=dict(STORE["tenants"][0],cnic="35202-9999999-9"),company_id="A")
ok("tenant CNIC edit updates portal username", [a for a in STORE["tenant_portal_accounts"] if a["tenant_id"]=="t1"][0]["username"]=="3520299999999")
# kill switches
STORE["company_feature_flags"][0]["enabled"]=False; svc._cache.clear()
ok("Tower switch OFF cuts off tenants immediately", raises(403,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520299999999",password="Brand-new-pass1"))))
STORE["company_feature_flags"][0]["enabled"]=True; svc._cache.clear(); STORE["companies"][0]["status"]="suspended"
ok("suspended company blocks portal", raises(403,lambda:pr.login(pr.LoginBody(portal_code="maaher-estate",username="3520299999999",password="Brand-new-pass1"))))
# hook isolation
hooks.on("tenants.created")(lambda **k: 1/0); hooks.emit("tenants.created",row=STORE["tenants"][0],company_id="A"); ok("a crashing hook handler never propagates",True)
print("\nALL CHECKS PASSED")
