from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_jwt_secret: str | None = None  # no longer required -- kept for backward compatibility
    supabase_service_role_key: str | None = None
    backend_public_url: str = "https://oneaccounts-property-management.vercel.app"  # used to build short shareable links (e.g. WhatsApp invoice links)

    class Config:
        env_file = ".env"


settings = Settings()
