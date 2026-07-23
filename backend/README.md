# Property Management API (FastAPI)

## Local run
1. `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and fill in your Supabase project's URL/keys
   (Project Settings -> API, and Project Settings -> API -> JWT Settings).
3. `uvicorn app.main:app --reload`
4. Visit http://localhost:8000/docs for interactive API docs (Swagger UI).

## How auth/isolation works
Every request must include `Authorization: Bearer <supabase_access_token>`
(the JWT you get from Supabase Auth on the frontend after login). The backend
forwards that token to Postgres on every query, so Row Level Security (from
schema.sql) is what actually enforces that a user only ever sees their own
company's data -- not application code.

## Folder structure
- `app/core/` - config + auth/DB dependency injection
- `app/crud/generic.py` - reusable CRUD factory for simple tables
- `app/routers/` - one file per resource; simple ones share the generic
  factory, complex ones (leases, invoices, security deposits, owner ledger,
  reports) have dedicated business logic
