"use client";

import { useEffect, useState } from "react";
import { api, Building, Room, Floor } from "@/lib/api";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";

const NEW_FLOOR_VALUE = "__new__";

export default function BuildingsPage() {
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [floors, setFloors] = useState<Floor[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [buildingSaving, setBuildingSaving] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [buildingForm, setBuildingForm] = useState({
    name: "",
    address: "",
    owner_name: "",
    owner_phone: "",
  });

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [roomSaving, setRoomSaving] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState({
    floor_id: "",
    new_floor_number: "",
    new_floor_name: "",
    room_number: "",
    room_type: "",
    base_rent: "",
  });

  function loadBuildings() {
    api.get<Building[]>("/buildings").then((data) => {
      setBuildings(data);
      if (data.length > 0 && !selected) setSelected(data[0].id);
    });
  }

  function loadRoomsAndFloors() {
    api.get<Room[]>("/rooms").then(setRooms);
    api.get<Floor[]>("/floors").then(setFloors);
  }

  useEffect(() => {
    loadBuildings();
    loadRoomsAndFloors();
  }, []);

  async function handleAddBuilding(e: React.FormEvent) {
    e.preventDefault();
    setBuildingSaving(true);
    setBuildingError(null);
    try {
      const created = await api.post<Building>("/buildings", buildingForm);
      setBuildingModalOpen(false);
      setBuildingForm({ name: "", address: "", owner_name: "", owner_phone: "" });
      loadBuildings();
      setSelected(created.id);
    } catch (err: any) {
      setBuildingError(err.message);
    } finally {
      setBuildingSaving(false);
    }
  }

  function openRoomModal() {
    setRoomError(null);
    const existingFloor = floorsForSelected[0];
    setRoomForm({
      floor_id: existingFloor ? existingFloor.id : NEW_FLOOR_VALUE,
      new_floor_number: String((floorsForSelected.length || 0) + 1),
      new_floor_name: "",
      room_number: "",
      room_type: "",
      base_rent: "",
    });
    setRoomModalOpen(true);
  }

  async function handleAddRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setRoomSaving(true);
    setRoomError(null);
    try {
      let floorId = roomForm.floor_id;

      if (floorId === NEW_FLOOR_VALUE) {
        const newFloor = await api.post<Floor>("/floors", {
          building_id: selected,
          floor_number: parseInt(roomForm.new_floor_number, 10) || 1,
          name: roomForm.new_floor_name || undefined,
        });
        floorId = newFloor.id;
      }

      await api.post("/rooms", {
        building_id: selected,
        floor_id: floorId,
        room_number: roomForm.room_number,
        room_type: roomForm.room_type || undefined,
        base_rent: roomForm.base_rent ? parseFloat(roomForm.base_rent) : undefined,
      });

      setRoomModalOpen(false);
      loadRoomsAndFloors();
    } catch (err: any) {
      setRoomError(err.message);
    } finally {
      setRoomSaving(false);
    }
  }

  const roomsForSelected = rooms?.filter((r) => r.building_id === selected) ?? [];
  const floorsForSelected = floors?.filter((f) => f.building_id === selected) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Buildings & rooms</h1>
          <p className="text-sm text-ink/55 mt-1">
            Every unit, its current status, and its maintenance history.
          </p>
        </div>
        <Button onClick={() => setBuildingModalOpen(true)}>Add building</Button>
      </div>

      {buildings && buildings.length > 0 && (
        <div className="flex items-center justify-between border-b border-border">
          <div className="flex gap-2">
            {buildings.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  selected === b.id
                    ? "border-brass-dark text-ink"
                    : "border-transparent text-ink/50 hover:text-ink"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={openRoomModal} className="mb-2">
            Add room
          </Button>
        </div>
      )}

      {buildings && buildings.length === 0 && (
        <div className="py-12 text-center text-sm text-ink/45 border border-dashed border-border rounded-card">
          No buildings yet — click &quot;Add building&quot; to create your first one.
        </div>
      )}

      {buildings && buildings.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {roomsForSelected.length === 0 && (
            <p className="col-span-full text-sm text-ink/45 py-8 text-center border border-dashed border-border rounded-card">
              No rooms yet for this building — click &quot;Add room&quot; above.
            </p>
          )}
          {roomsForSelected.map((room) => (
            <div key={room.id} className="card p-4 text-left">
              <div className="flex items-center justify-between mb-3">
                <span className="font-display text-lg font-semibold">{room.room_number}</span>
                <StampBadge status={room.status} />
              </div>
              <p className="text-xs text-ink/50">{room.room_type ?? "Unit"}</p>
              {room.base_rent && (
                <p className="text-sm figures mt-2 text-ink/70">
                  Rs {room.base_rent.toLocaleString("en-PK")}/mo
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add building modal */}
      <Modal open={buildingModalOpen} onClose={() => setBuildingModalOpen(false)} title="Add building">
        <form onSubmit={handleAddBuilding} className="space-y-4">
          <Field label="Building name">
            <Input
              required
              value={buildingForm.name}
              onChange={(e) => setBuildingForm({ ...buildingForm, name: e.target.value })}
              placeholder="e.g. Sunrise Heights"
            />
          </Field>
          <Field label="Address">
            <Input
              value={buildingForm.address}
              onChange={(e) => setBuildingForm({ ...buildingForm, address: e.target.value })}
            />
          </Field>
          <Field label="Owner name" hint="Who this building's owner ledger is for.">
            <Input
              value={buildingForm.owner_name}
              onChange={(e) => setBuildingForm({ ...buildingForm, owner_name: e.target.value })}
            />
          </Field>
          <Field label="Owner phone">
            <Input
              value={buildingForm.owner_phone}
              onChange={(e) => setBuildingForm({ ...buildingForm, owner_phone: e.target.value })}
            />
          </Field>
          {buildingError && <p className="text-sm text-stamp-red">{buildingError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setBuildingModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={buildingSaving}>
              {buildingSaving ? "Saving…" : "Add building"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add room modal (creates a floor automatically if needed) */}
      <Modal open={roomModalOpen} onClose={() => setRoomModalOpen(false)} title="Add room">
        <form onSubmit={handleAddRoom} className="space-y-4">
          <Field label="Floor">
            <Select
              value={roomForm.floor_id}
              onChange={(e) => setRoomForm({ ...roomForm, floor_id: e.target.value })}
            >
              {floorsForSelected.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name || `Floor ${f.floor_number}`}
                </option>
              ))}
              <option value={NEW_FLOOR_VALUE}>+ Add a new floor…</option>
            </Select>
          </Field>

          {roomForm.floor_id === NEW_FLOOR_VALUE && (
            <div className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-border">
              <Field label="Floor number">
                <Input
                  type="number"
                  required
                  value={roomForm.new_floor_number}
                  onChange={(e) =>
                    setRoomForm({ ...roomForm, new_floor_number: e.target.value })
                  }
                />
              </Field>
              <Field label="Floor name (optional)">
                <Input
                  placeholder="e.g. Ground Floor"
                  value={roomForm.new_floor_name}
                  onChange={(e) => setRoomForm({ ...roomForm, new_floor_name: e.target.value })}
                />
              </Field>
            </div>
          )}

          <Field label="Room number">
            <Input
              required
              placeholder="e.g. A-101"
              value={roomForm.room_number}
              onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
            />
          </Field>
          <Field label="Room type (optional)">
            <Input
              placeholder="e.g. 2-bed apartment, studio, shop"
              value={roomForm.room_type}
              onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })}
            />
          </Field>
          <Field label="Base rent (optional)" hint="A reference amount — the real rent is set per-lease.">
            <Input
              type="number"
              value={roomForm.base_rent}
              onChange={(e) => setRoomForm({ ...roomForm, base_rent: e.target.value })}
            />
          </Field>

          {roomError && <p className="text-sm text-stamp-red">{roomError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setRoomModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={roomSaving}>
              {roomSaving ? "Saving…" : "Add room"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
