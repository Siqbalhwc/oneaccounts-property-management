from app.main import app

# Vercel's Python runtime auto-detects an ASGI-compatible `app` object
# exported from a file inside the `api/` folder, and serves it as a
# serverless function. This file just re-exports our existing FastAPI
# app so Vercel can find it -- no logic lives here.
