from app.crud.generic import build_crud_router

buildings_router = build_crud_router("buildings", ["Buildings"])
floors_router = build_crud_router("floors", ["Floors"])
rooms_router = build_crud_router("rooms", ["Rooms"])
room_history_router = build_crud_router("room_history", ["Room History"])
tenants_router = build_crud_router("tenants", ["Tenants"])
expense_categories_router = build_crud_router("expense_categories", ["Expense Categories"])
expenses_router = build_crud_router("expenses", ["Expenses"])
staff_router = build_crud_router("staff", ["Staff"])
salary_payments_router = build_crud_router("salary_payments", ["Salary Payments"])
