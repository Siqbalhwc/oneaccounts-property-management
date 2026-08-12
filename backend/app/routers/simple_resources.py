from app.crud.generic import build_crud_router
from app.services.phone import validate_and_normalize

owners_router = build_crud_router("owners", ["Owners"], archivable=True)
buildings_router = build_crud_router("buildings", ["Buildings"], archivable=True)
floors_router = build_crud_router("floors", ["Floors"])
rooms_router = build_crud_router("rooms", ["Rooms"], archivable=True)
room_history_router = build_crud_router("room_history", ["Room History"])
tenants_router = build_crud_router(
    "tenants", ["Tenants"], archivable=True,
    validators={"phone": validate_and_normalize, "emergency_contact_phone": validate_and_normalize},
)
expense_categories_router = build_crud_router("expense_categories", ["Expense Categories"])
staff_router = build_crud_router("staff", ["Staff"])
