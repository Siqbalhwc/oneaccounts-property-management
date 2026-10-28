"""
"Name of unit" -- what this company calls the thing it rents out.

One company may say Apartment, another Shop or Flat. The choice is stored as a
short KEY on companies.unit_type ("apartment", "shop", ...), and this file is
the ONLY place that maps a key to the words people read. Consequences:

  * Users can only SELECT from UNIT_TYPES -- there is no free text, so there
    is no spelling, plural or capitalisation to get wrong; the plural is part
    of the catalog entry.
  * An unknown/blank key always falls back to Apartment, so a bad value can
    never put arbitrary text on a screen or a PDF.
  * Only the DISPLAYED word changes. Tables, columns, routes and journal tags
    (rooms, room_id, ...) are untouched.

Everything here is pure Python with no dependency on the rest of the app, so
other OneAccounts modules (e.g. construction) can reuse the same pattern.
"""

import re
import time
from typing import Dict, List, Optional

# (key, singular, plural) -- kept alphabetical by singular for the dropdown.
_RAW = [
    ("apartment", "Apartment", "Apartments"),
    ("bed", "Bed", "Beds"),
    ("booth", "Booth", "Booths"),
    ("bungalow", "Bungalow", "Bungalows"),
    ("cabin", "Cabin", "Cabins"),
    ("chamber", "Chamber", "Chambers"),
    ("clinic", "Clinic", "Clinics"),
    ("cubicle", "Cubicle", "Cubicles"),
    ("desk", "Desk", "Desks"),
    ("farmhouse", "Farmhouse", "Farmhouses"),
    ("factory", "Factory", "Factories"),
    ("flat", "Flat", "Flats"),
    ("garage", "Garage", "Garages"),
    ("godown", "Godown", "Godowns"),
    ("hall", "Hall", "Halls"),
    ("house", "House", "Houses"),
    ("kiosk", "Kiosk", "Kiosks"),
    ("office", "Office", "Offices"),
    ("parking_slot", "Parking slot", "Parking slots"),
    ("penthouse", "Penthouse", "Penthouses"),
    ("plot", "Plot", "Plots"),
    ("portion", "Portion", "Portions"),
    ("property", "Property", "Properties"),
    ("room", "Room", "Rooms"),
    ("shop", "Shop", "Shops"),
    ("showroom", "Showroom", "Showrooms"),
    ("space", "Space", "Spaces"),
    ("stall", "Stall", "Stalls"),
    ("store", "Store", "Stores"),
    ("studio", "Studio", "Studios"),
    ("suite", "Suite", "Suites"),
    ("unit", "Unit", "Units"),
    ("villa", "Villa", "Villas"),
    ("warehouse", "Warehouse", "Warehouses"),
    ("workshop", "Workshop", "Workshops"),
]

UNIT_TYPES: List[Dict[str, str]] = [{"key": k, "singular": s, "plural": p} for k, s, p in _RAW]
UNIT_KEYS = {u["key"] for u in UNIT_TYPES}
DEFAULT_UNIT_KEY = "apartment"
_BY_KEY = {u["key"]: u for u in UNIT_TYPES}


def resolve_unit(key: Optional[str]) -> Dict[str, str]:
    """Key -> {key, singular, plural}. Anything unknown falls back to Apartment."""
    return _BY_KEY.get(key or "", _BY_KEY[DEFAULT_UNIT_KEY])


def unit_from_company(company: Optional[dict]) -> Dict[str, str]:
    """For code that already holds a companies row (every PDF context does)."""
    return resolve_unit((company or {}).get("unit_type"))


# ---------------------------------------------------------------------------
# Wording helpers
# ---------------------------------------------------------------------------
def _article(word: str) -> str:
    w = word.lower()
    if w.startswith(("uni", "use", "usu")):  # "a unit", "a user"
        return "a"
    return "an" if w[:1] in "aeiou" else "a"


_ARTICLE_RE = re.compile(r"\b(An?|an?) (apartment|Apartment)\b")
_PLURAL_RE = re.compile(r"\b(Apartments|apartments)\b")
_SINGULAR_RE = re.compile(r"\b(Apartment|apartment)\b")


def apply_unit_words(text: str, unit: Dict[str, str]) -> str:
    """Rewrite the word 'apartment' in a built-in sentence to this company's
    word, fixing 'a'/'an' ('an apartment' -> 'a shop') and capitalisation.
    Used on OUR OWN fixed strings only -- never on user-entered text."""
    if not text:
        return text

    def _with_article(m: "re.Match[str]") -> str:
        word = unit["singular"] if m.group(2)[0].isupper() else unit["singular"].lower()
        art = _article(word)
        if m.group(1)[0].isupper():
            art = art.capitalize()
        return f"{art} {word}"

    text = _ARTICLE_RE.sub(_with_article, text)
    text = _PLURAL_RE.sub(lambda m: unit["plural"] if m.group(1)[0].isupper() else unit["plural"].lower(), text)
    text = _SINGULAR_RE.sub(lambda m: unit["singular"] if m.group(1)[0].isupper() else unit["singular"].lower(), text)
    return text


# ---------------------------------------------------------------------------
# Reading the setting (short cache: the word is read on busy paths such as
# invoice generation, and changes about once in a company's lifetime)
# ---------------------------------------------------------------------------
_TTL_SECONDS = 30
_CACHE: Dict[str, tuple] = {}


def invalidate_unit_cache(company_id: Optional[str] = None) -> None:
    if company_id:
        _CACHE.pop(company_id, None)
    else:
        _CACHE.clear()


def get_unit(client, company_id: str, use_cache: bool = True) -> Dict[str, str]:
    """This company's unit words. NEVER raises: if the column is missing (SQL
    not applied yet) or the read fails, the default is returned, so a label
    problem can never block an invoice, a receipt or a PDF."""
    now = time.time()
    if use_cache:
        hit = _CACHE.get(company_id)
        if hit and hit[0] > now:
            return resolve_unit(hit[1])
    try:
        rows = client.table("companies").select("unit_type").eq("id", company_id).execute().data
        key = (rows[0].get("unit_type") if rows else None) or DEFAULT_UNIT_KEY
    except Exception:
        return resolve_unit(None)
    _CACHE[company_id] = (now + _TTL_SECONDS, key)
    return resolve_unit(key)
