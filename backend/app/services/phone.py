"""
Shared Pakistani phone number handling.

This system stores tenant phone numbers as 10 digits starting with '3' --
no country code, no leading zero (e.g. "3214315665"). That convention is
set here in ONE place now; normalize_to_whatsapp() (used when sending a
WhatsApp link) and validate_and_normalize() (used when a tenant is
created/edited) both build on it, instead of each having their own copy
that could quietly drift out of sync with the other.
"""

from fastapi import HTTPException

PHONE_FORMAT_HINT = "03XX-XXXXXXX (e.g. 0300-1234567) or +923XXXXXXXXX"


def to_storage_format(phone: str) -> str:
    """Converts any common input format (03XX-XXXXXXX, +923XXXXXXXXX,
    00923XXXXXXXXX, or already-bare 3XXXXXXXXX) into this system's stored
    10-digit format. Does NOT validate -- may return something that still
    isn't a valid number if the input was garbage; call is_valid() after."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0092") and len(digits) == 14:
        digits = digits[2:]
    if digits.startswith("92") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits


def is_valid(storage_format_digits: str) -> bool:
    """True if a string already in storage format is a well-formed PK mobile
    number: exactly 10 digits, starting with 3 (all PK mobile operators)."""
    return len(storage_format_digits) == 10 and storage_format_digits.isdigit() and storage_format_digits.startswith("3")


def validate_and_normalize(raw: str) -> str:
    """
    For use at the point a human types a number in (tenant create/edit).
    Raises HTTPException(400) with a clear, actionable message on anything
    malformed, otherwise returns the cleaned 10-digit storage format.
    """
    if raw is None or not str(raw).strip():
        raise HTTPException(status_code=400, detail=f"Phone number is required. Format: {PHONE_FORMAT_HINT}")
    storage_format = to_storage_format(str(raw))
    if not is_valid(storage_format):
        raise HTTPException(
            status_code=400,
            detail=f"'{raw}' doesn't look like a valid Pakistani mobile number. Format: {PHONE_FORMAT_HINT}",
        )
    return storage_format


def normalize_to_whatsapp(phone: str) -> str:
    """
    Converts a stored (or any common local) phone format into the
    international digits-only format wa.me requires (e.g. "923001234567").
    Unlike validate_and_normalize(), this doesn't raise -- it's used on
    numbers already accepted at write time, so a failure here would be a
    data problem to investigate, not a form the user can fix on the spot.
    """
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0092") and len(digits) == 14:
        digits = digits[2:]
    if digits.startswith("92") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 11:
        return "92" + digits[1:]
    if digits.startswith("3") and len(digits) == 10:
        return "92" + digits
    return digits  # already looks international, or malformed -- pass through as-is
