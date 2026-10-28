"""
Room / apartment / building search -- ONE shared resolver for every list page.

Room-wise and building-wise lookup is the backbone of property management, so
the logic lives here, once, on the server. A list page sends what the user
typed; this module turns it into "which rooms and buildings does that mean",
and each page's handler (see routers/property_search.py) turns that into "which
of MY records belong to those rooms/buildings".

What the user can type
  * a building name            "Sunrise"            -> every room in Sunrise
  * a room / apartment number  "A-101", "202"       -> that room, in any building
  * both together              "Sunrise 101"        -> room 101 in Sunrise only
  * label words are ignored    "Sunrise Apartment 101" == "Sunrise 101"
Every word typed must match either the building's name or the room's number
(case-insensitive, partial matches allowed), so adding a word only narrows.

Isolation
  Every query here runs through the CALLER'S OWN RLS-scoped Supabase client
  (never the service-role client). Postgres therefore only ever returns rooms
  and buildings of the caller's own company -- and, for building-scoped users,
  only their buildings. A search can never reach another company's data, no
  matter what is typed.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from supabase import Client

from app.services.invoice_batch import fetch_all, fetch_in

# Words people type around a room number that are labels, not part of any
# building name or room number.
FILLER_WORDS = {
    "apartment", "apt", "apt.", "room", "flat", "unit", "no", "no.", "-", "\u2013", "\u2014",
    # the other selectable "Name of unit" words that are unlikely to be part of a building name
    "shop", "office", "portion", "villa", "suite", "studio", "plot", "godown", "showroom", "kiosk", "stall", "booth", "cabin",
}
MAX_TERMS = 6
MAX_TERM_LENGTH = 60

ROOM_COLUMNS = "id, room_number, building_id, owner_id"
BUILDING_COLUMNS = "id, name, owner_id"

# Above this many ids, reading the whole table once and filtering in Python is
# cheaper than dozens of small .in_() queries.
FULL_SCAN_ABOVE = 300


def split_terms(raw: Optional[str]) -> list[str]:
    """'Sunrise Apartment #101' -> ['Sunrise', '101']."""
    words = [w.lstrip("#") for w in re.split(r"[\s,]+", (raw or "").strip())]
    terms = [w[:MAX_TERM_LENGTH] for w in words if w and w.lower() not in FILLER_WORDS]
    return terms[:MAX_TERMS]


def _like(term: str) -> str:
    """Contains-pattern for ILIKE, with the user's own % and _ made literal."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@dataclass
class PropertyMatch:
    terms: list[str] = field(default_factory=list)
    rooms: dict[str, dict] = field(default_factory=dict)  # room_id -> room row
    building_ids: set[str] = field(default_factory=set)  # buildings whose NAME matches every word
    buildings: dict[str, dict] = field(default_factory=dict)  # building_id -> building row
    named_building_hit: bool = False  # did any typed word match a building name?

    @property
    def room_ids(self) -> set[str]:
        return set(self.rooms)

    @property
    def empty(self) -> bool:
        return not self.rooms and not self.building_ids

    def room_label(self, room_id: str, unit_word: str = "Apartment") -> str:
        room = self.rooms.get(room_id) or {}
        building = self.buildings.get(room.get("building_id")) or {}
        building_name = building.get("name") or "\u2014"
        return f"{building_name} \u2014 {unit_word} {room.get('room_number', '?')}"

    def building_scope(self) -> set[str]:
        """Buildings for records that belong to a building, never to a room
        (e.g. staff). Includes the building of a matched room only when the
        user actually typed a building name -- a bare '101' must not pull in
        every building that happens to have a room 101."""
        scope = set(self.building_ids)
        if self.named_building_hit:
            scope |= {r["building_id"] for r in self.rooms.values() if r.get("building_id")}
        return scope

    def effective_owner_ids(self) -> set[str]:
        """Owners of the matched rooms (a room's own owner, else its building's)
        plus owners of the matched buildings -- same rule as resolve_room_owner()."""
        owners: set[str] = set()
        for room in self.rooms.values():
            owner = room.get("owner_id") or (self.buildings.get(room.get("building_id")) or {}).get("owner_id")
            if owner:
                owners.add(owner)
        for building_id in self.building_ids:
            owner = (self.buildings.get(building_id) or {}).get("owner_id")
            if owner:
                owners.add(owner)
        return owners


def resolve_property_term(supabase: Client, raw: Optional[str]) -> PropertyMatch:
    """Typed text -> the rooms and buildings it means. See the module docstring."""
    terms = split_terms(raw)
    if not terms:
        return PropertyMatch()

    per_term_rooms: list[dict[str, dict]] = []
    per_term_buildings: list[dict[str, dict]] = []
    for term in terms:
        pattern = _like(term)
        building_rows = fetch_all(
            lambda: supabase.table("buildings").select(BUILDING_COLUMNS).ilike("name", pattern).order("id")
        )
        buildings = {b["id"]: b for b in building_rows}
        room_rows = fetch_all(
            lambda: supabase.table("rooms").select(ROOM_COLUMNS).ilike("room_number", pattern).order("id")
        )
        rooms = {r["id"]: r for r in room_rows}
        if buildings:
            for r in fetch_in(supabase, "rooms", ROOM_COLUMNS, "building_id", list(buildings)):
                rooms[r["id"]] = r
        if not rooms and not buildings:
            return PropertyMatch(terms=terms)  # this word matches nothing, so the whole phrase can't
        per_term_rooms.append(rooms)
        per_term_buildings.append(buildings)

    room_ids = set.intersection(*(set(m) for m in per_term_rooms))
    building_ids = set.intersection(*(set(m) for m in per_term_buildings))

    known_buildings: dict[str, dict] = {}
    for m in per_term_buildings:
        known_buildings.update(m)
    rooms = {rid: per_term_rooms[0][rid] for rid in room_ids}
    missing = {r["building_id"] for r in rooms.values() if r.get("building_id")} - set(known_buildings)
    if missing:
        for b in fetch_in(supabase, "buildings", BUILDING_COLUMNS, "id", list(missing)):
            known_buildings[b["id"]] = b

    return PropertyMatch(
        terms=terms,
        rooms=rooms,
        building_ids=building_ids,
        buildings=known_buildings,
        named_building_hit=any(per_term_buildings),
    )


def rows_in(
    supabase: Client,
    table: str,
    columns: str,
    column: str,
    ids,
    company_id: str,
    extra=None,
) -> list[dict]:
    """
    select <columns> from <table> where company_id = <caller's> and <column> in (ids).
    Small id sets use chunked .in_() reads; very large ones (a short search like
    '1' can match thousands of rooms) read the table once and filter here.
    """
    ids = list(ids)
    if not ids:
        return []

    def scoped(query):
        query = query.eq("company_id", company_id)
        return extra(query) if extra else query

    if len(ids) <= FULL_SCAN_ABOVE:
        return fetch_in(supabase, table, columns, column, ids, extra=scoped)

    wanted = set(ids)
    wanted_columns = [c.strip() for c in columns.split(",")]
    select_columns = columns if column in wanted_columns else f"{columns}, {column}"
    rows = fetch_all(lambda: scoped(supabase.table(table).select(select_columns)).order("id"))
    return [r for r in rows if r.get(column) in wanted]
