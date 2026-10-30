# Public sign-in branding endpoint reveals only name and logo
# Runs with no live database: a small in-memory stand-in is used. Start it with run_all.py.
import os, copy
os.environ.update(SUPABASE_URL="https://x.supabase.co", SUPABASE_ANON_KEY="a", SUPABASE_SERVICE_ROLE_KEY="svc-secret")
import app.plugins.tenant_portal.service as svc
import app.plugins.tenant_portal.portal_router as pr
if not hasattr(pr, "branding"):
    print("SKIP sign-in branding is not installed in this version")
    raise SystemExit(0)
STORE={"tenant_portal_settings":[{"company_id":"A","portal_code":"maaher","permissions":{}},{"company_id":"B","portal_code":"offco"},{"company_id":"S","portal_code":"susp"}],
 "company_feature_flags":[{"company_id":"A","feature_key":"tenant_portal","enabled":True},{"company_id":"S","feature_key":"tenant_portal","enabled":True},{"company_id":"B","feature_key":"tenant_portal","enabled":False}],
 "companies":[{"id":"A","name":"Maaher Estate","logo_url":"https://cdn.example/logo.png","status":"active","secret_field":"x","email":"owner@private.com"},{"id":"B","name":"Off Co","logo_url":None,"status":"active"},{"id":"S","name":"Susp Co","logo_url":"https://cdn.example/s.png","status":"suspended"}]}
class Q:
    def __init__(s,t): s.t=t; s.f=[]
    def select(s,cols="*",**k): s.cols=[c.strip() for c in cols.split(",")] if cols!="*" else None; return s
    def eq(s,k,v): s.f.append(lambda r:r.get(k)==v); return s
    def execute(s):
        class R: pass
        r=R(); r.data=[ {k:v for k,v in copy.deepcopy(x).items() if s.cols is None or k in s.cols} for x in STORE[s.t] if all(f(x) for f in s.f)]; return r
class C:
    def table(s,t): return Q(t)
pr.get_service_client=lambda:C(); svc.get_service_client=lambda:C(); svc._cache.clear()
ok=lambda l,cond: print(("PASS " if cond else "FAIL ")+l) or (cond or exit(1))
E={"company_name":None,"logo_url":None}
ok("active company: only name and logo are returned", pr.branding("maaher")=={"company_name":"Maaher Estate","logo_url":"https://cdn.example/logo.png"})
ok("code is case/space tolerant", pr.branding("  MAAHER ")["company_name"]=="Maaher Estate")
ok("unknown code -> empty (nothing revealed)", pr.branding("nope")==E and pr.branding("")==E)
ok("plug-in switched off for that company -> empty", pr.branding("offco")==E)
ok("suspended company -> empty", pr.branding("susp")==E)
ok("no other company field can leak", set(pr.branding("maaher"))=={"company_name","logo_url"})
print("\nALL CHECKS PASSED")
