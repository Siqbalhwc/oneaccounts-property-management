# Add this to app/core/deps.py, alongside require_owner_or_admin.
# (Your platform_admin.py / Tower view almost certainly already has some
# version of this check inline -- if so, just reuse that one instead of
# adding a duplicate. This is here in case it doesn't exist as a reusable
# dependency yet.)

def require_platform_admin(
    supabase: Client = Depends(get_supabase),
    user: dict = Depends(get_current_user),
) -> None:
    """Blocks the request unless the caller's profile has is_platform_admin = true."""
    profile = (
        supabase.table("profiles")
        .select("is_platform_admin")
        .eq("id", user["user_id"])
        .single()
        .execute()
    )
    if not profile.data or not profile.data.get("is_platform_admin"):
        raise HTTPException(status_code=403, detail="Platform admin access required.")
