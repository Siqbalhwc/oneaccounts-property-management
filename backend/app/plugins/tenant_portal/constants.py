FEATURE_KEY = "tenant_portal"

# What an admin can allow or block for tenants. Default: everything allowed.
PERMISSION_LABELS = {
    "view_invoices": "See their invoices",
    "view_ledger": "See their ledger statement",
    "submit_payment": "Send a payment (cash/bank) for approval",
    "submit_repair": "Send repair / maintenance requests",
    "download_receipts": "Download receipts",
}
DEFAULT_PERMISSIONS = {k: True for k in PERMISSION_LABELS}

MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 15
SESSION_HOURS = 8
MIN_PASSWORD_LENGTH = 8
