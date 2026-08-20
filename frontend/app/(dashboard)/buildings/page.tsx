"use client";

import { useEffect, useState } from "react";
import { api, Building, Room, Floor, Profile } from "@/lib/api";
import { StampBadge } from "@/components/ui/StampBadge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { HistoryPanel } from "@/components/ui/HistoryPanel";
import { Field, Input, Select } from "@/components/ui/Field";

const NEW_FLOOR_VALUE = "__new__";
const NEW_TYPE_VALUE = "__new_type__";
const NEW_OWNER_VALUE = "__new_owner__";
const ROOM_STATUSES = ["vacant", "occupied", "under_maintenance", "reserved"] as const;

// Augmented locally since lib/api.ts's Room type may not yet declare owner_id --
// safe either way since it's optional (a plain Room is still assignable to this).
type RoomWithOwner = Room & { owner_id?: string | null };
type OwnerRecord = { id: string; name: string; phone?: string };

export default function BuildingsPage() {
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [rooms, setRooms] = useState<RoomWithOwner[] | null>(null);
  const [floors, setFloors] = useState<Floor[] | null>(null);
  const [owners, setOwners] = useState<OwnerRecord[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [roomSearch, setRoomSearch] = useState("");
  const [roomStatusFilter, setRoomStatusFilter] = useState("");

  // --- Add / Edit building ---
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const [buildingSaving, setBuildingSaving] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [buildingForm, setBuildingForm] = useState({
    name: "",
    address: "",
    owner_name: "",
    owner_phone: "",
  });
  const [archiveBuildingTarget, setArchiveBuildingTarget] = useState<Building | null>(null);
  const [archivingBuilding, setArchivingBuilding] = useState(false);

  // --- Add / Edit room ---
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomSaving, setRoomSaving] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState({
    floor_id: "",
    new_floor_number: "",
    new_floor_name: "",
    room_number: "",
    room_type_select: "",
    room_type_custom: "",
    base_rent: "",
    status: "vacant" as string,
    owner_id: "",           // "" = inherit from building
    new_owner_name: "",
    new_owner_phone: "",
  });
  const [archiveRoomTarget, setArchiveRoomTarget] = useState<Room | null>(null);
  const [archivingRoom, setArchivingRoom] = useState(false);

  function loadBuildings() {
    api.get<Building[]>("/buildings").then((data) => {
      setBuildings(data);
      if (data.length > 0 && !selected) setSelected(data[0].id);
    });
  }

  function loadRoomsAndFloors() {
    api.get<RoomWithOwner[]>("/rooms").then(setRooms);
    api.get<Floor[]>("/floors").then(setFloors);
  }

  useEffect(() => {
    loadBuildings();
    loadRoomsAndFloors();
    api.get<Profile>("/profile/me").then((p) => setMyRole(p.role));
    api.get<OwnerRecord[]>("/owners").then(setOwners);
  }, []);

  const canManage = myRole === "owner" || myRole === "admin";

  // ---------------- Building add/edit ----------------
  function openAddBuildingModal() {
    setEditingBuildingId(null);
    setBuildingError(null);
    setBuildingForm({ name: "", address: "", owner_name: "", owner_phone: "" });
    setBuildingModalOpen(true);
  }

  function openEditBuildingModal(b: Building) {
    setEditingBuildingId(b.id);
    setBuildingError(null);
    setBuildingForm({
      name: b.name,
      address: b.address ?? "",
      owner_name: b.owner_name ?? "",
      owner_phone: b.owner_phone ?? "",
    });
    setBuildingModalOpen(true);
  }

  async function handleSaveBuilding(e: React.FormEvent) {
    e.preventDefault();
    setBuildingSaving(true);
    setBuildingError(null);
    try {
      if (editingBuildingId) {
        await api.patch(`/buildings/${editingBuildingId}`, buildingForm);
      } else {
        const created = await api.post<Building>("/buildings", buildingForm);
        setSelected(created.id);
      }
      setBuildingModalOpen(false);
      loadBuildings();
    } catch (err: any) {
      setBuildingError(err.message);
    } finally {
      setBuildingSaving(false);
    }
  }

  async function handleArchiveBuilding() {
    if (!archiveBuildingTarget) return;
    setArchivingBuilding(true);
    try {
      await api.post(`/buildings/${archiveBuildingTarget.id}/archive`, {});
      setArchiveBuildingTarget(null);
      loadBuildings();
    } finally {
      setArchivingBuilding(false);
    }
  }

  // ---------------- Room add/edit ----------------
  const existingRoomTypes = Array.from(
    new Set((rooms ?? []).map((r) => r.room_type).filter((t): t is string => !!t))
  ).sort();

  function suggestNextRoomNumber(floorId: string): string {
    const floorRooms = (rooms ?? []).filter((r) => r.floor_id === floorId);
    let best: { prefix: string; num: number; width: number } | null = null;
    for (const r of floorRooms) {
      const match = r.room_number.match(/^(.*?)(\d+)$/);
      if (match) {
        const num = parseInt(match[2], 10);
        if (!best || num > best.num) {
          best = { prefix: match[1], num, width: match[2].length };
        }
      }
    }
    if (!best) return "";
    const nextStr = String(best.num + 1).padStart(best.width, "0");
    return `${best.prefix}${nextStr}`;
  }

  function isDuplicateRoomNumber(value: string, excludeRoomId?: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return (rooms ?? []).some(
      (r) =>
        r.building_id === selected &&
        r.id !== excludeRoomId &&
        r.room_number.trim().toLowerCase() === normalized
    );
  }

  function openAddRoomModal() {
    setEditingRoomId(null);
    setRoomError(null);
    const existingFloor = floorsForSelected[0];
    setRoomForm({
      floor_id: existingFloor ? existingFloor.id : NEW_FLOOR_VALUE,
      new_floor_number: String((floorsForSelected.length || 0) + 1),
      new_floor_name: "",
      room_number: existingFloor ? suggestNextRoomNumber(existingFloor.id) : "",
      room_type_select: existingRoomTypes[0] || NEW_TYPE_VALUE,
      room_type_custom: "",
      base_rent: "",
      status: "vacant",
      owner_id: "",
      new_owner_name: "",
      new_owner_phone: "",
    });
    setRoomModalOpen(true);
  }

  function openEditRoomModal(room: RoomWithOwner) {
    setEditingRoomId(room.id);
    setRoomError(null);
    const typeIsKnown = room.room_type && existingRoomTypes.includes(room.room_type);
    setRoomForm({
      floor_id: room.floor_id,
      new_floor_number: "",
      new_floor_name: "",
      room_number: room.room_number,
      room_type_select: typeIsKnown ? room.room_type! : NEW_TYPE_VALUE,
      room_type_custom: typeIsKnown ? "" : room.room_type ?? "",
      base_rent: room.base_rent ? String(room.base_rent) : "",
      status: room.status,
      owner_id: room.owner_id ?? "",
      new_owner_name: "",
      new_owner_phone: "",
    });
    setRoomModalOpen(true);
  }

  function handleFloorChange(newFloorId: string) {
    setRoomForm((prev) => ({
      ...prev,
      floor_id: newFloorId,
      room_number:
        newFloorId === NEW_FLOOR_VALUE || editingRoomId
          ? prev.room_number
          : suggestNextRoomNumber(newFloorId),
    }));
  }

  async function handleSaveRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (isDuplicateRoomNumber(roomForm.room_number, editingRoomId ?? undefined)) {
      setRoomError(`Room "${roomForm.room_number}" already exists in this building.`);
      return;
    }
    setRoomSaving(true);
    setRoomError(null);
    try {
      const roomType =
        roomForm.room_type_select === NEW_TYPE_VALUE
          ? roomForm.room_type_custom.trim()
          : roomForm.room_type_select;

      // Resolve owner_id: create a new owner first if the person chose
      // "+ Add new owner…", otherwise use the picked one, or null to
      // explicitly inherit the building's default owner.
      let ownerId: string | null = roomForm.owner_id || null;
      if (roomForm.owner_id === NEW_OWNER_VALUE) {
        if (!roomForm.new_owner_name.trim()) {
          setRoomError("Enter a name for the new owner.");
          setRoomSaving(false);
          return;
        }
        const newOwner = await api.post<OwnerRecord>("/owners", {
          name: roomForm.new_owner_name.trim(),
          phone: roomForm.new_owner_phone || undefined,
        });
        ownerId = newOwner.id;
        setOwners((prev) => [...(prev ?? []), newOwner]);
      }

      if (editingRoomId) {
        await api.patch(`/rooms/${editingRoomId}`, {
          room_number: roomForm.room_number,
          room_type: roomType || undefined,
          base_rent: roomForm.base_rent ? parseFloat(roomForm.base_rent) : undefined,
          status: roomForm.status,
          owner_id: ownerId,
        });
      } else {
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
          room_type: roomType || undefined,
          base_rent: roomForm.base_rent ? parseFloat(roomForm.base_rent) : undefined,
          owner_id: ownerId,
        });
      }
      setRoomModalOpen(false);
      loadRoomsAndFloors();
    } catch (err: any) {
      setRoomError(err.message);
    } finally {
      setRoomSaving(false);
    }
  }

  async function handleArchiveRoom() {
    if (!archiveRoomTarget) return;
    setArchivingRoom(true);
    try {
      await api.post(`/rooms/${archiveRoomTarget.id}/archive`, {});
      setArchiveRoomTarget(null);
      setRoomModalOpen(false);
      loadRoomsAndFloors();
    } finally {
      setArchivingRoom(false);
    }
  }

  const roomsForSelected = (rooms?.filter((r) => r.building_id === selected) ?? []).filter((r) => {
    if (roomStatusFilter && r.status !== roomStatusFilter) return false;
    if (roomSearch.trim()) {
      const q = roomSearch.toLowerCase();
      if (!r.room_number.toLowerCase().includes(q) && !(r.room_type ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const floorsForSelected = floors?.filter((f) => f.building_id === selected) ?? [];
  const selectedBuilding = buildings?.find((b) => b.id === selected);
  const ownerName = (id: string) => owners?.find((o) => o.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Buildings & rooms</h1>
          <p className="text-sm text-ink/55 mt-1">
            Every unit, its current status, and its maintenance history.
          </p>
        </div>
        <Button onClick={openAddBuildingModal}>Add building</Button>
      </div>

      {buildings && buildings.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-border">
          <div className="flex gap-2 overflow-x-auto min-w-0 [scrollbar-width:thin]">
            {buildings.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                  selected === b.id
                    ? "border-brass-dark text-ink"
                    : "border-transparent text-ink/50 hover:text-ink"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mb-2 no-print shrink-0">
            {selectedBuilding && (
              <>
                <Button variant="ghost" onClick={() => openEditBuildingModal(selectedBuilding)}>
                  Edit building
                </Button>
                {canManage && (
                  <Button variant="ghost" onClick={() => setArchiveBuildingTarget(selectedBuilding)}>
                    Archive building
                  </Button>
                )}
              </>
            )}
            <Button variant="secondary" onClick={openAddRoomModal}>
              Add room
            </Button>
          </div>
        </div>
      )}

      {buildings && buildings.length === 0 && (
        <div className="py-12 text-center text-sm text-ink/45 border border-dashed border-border rounded-card">
          No buildings yet — click &quot;Add building&quot; to create your first one.
        </div>
      )}

      {buildings && buildings.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <Input
                placeholder="Search rooms by number or type…"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="sm:w-56 shrink-0">
              <Select value={roomStatusFilter} onChange={(e) => setRoomStatusFilter(e.target.value)} className="w-full">
                <option value="">All statuses</option>
                {ROOM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {roomsForSelected.length === 0 && (
              <p className="col-span-full text-sm text-ink/45 py-8 text-center border border-dashed border-border rounded-card">
                {roomSearch || roomStatusFilter
                  ? "No rooms match this search/filter."
                  : 'No rooms yet for this building — click "Add room" above.'}
              </p>
            )}
            {roomsForSelected.map((room) => (
              <button
                key={room.id}
                onClick={() => openEditRoomModal(room)}
                className="card p-4 text-left hover:border-brass-dark/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-display text-lg font-semibold">{room.room_number}</span>
                  <StampBadge status={room.status} />
                </div>
                <p className="text-xs text-ink/50">{room.room_type ?? "Unit"}</p>
                {room.base_rent && (
                  <p className="text-sm figures mt-2 text-ink/70">
                    Rs {Number(room.base_rent).toLocaleString("en-PK")}/mo
                  </p>
                )}
                {room.owner_id && (
                  <p className="text-[10px] text-brass-dark mt-1.5 truncate">
                    Owner: {ownerName(room.owner_id)}
                  </p>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Add / Edit building modal */}
      <Modal
        open={buildingModalOpen}
        onClose={() => setBuildingModalOpen(false)}
        title={editingBuildingId ? "Edit building" : "Add building"}
      >
        <form onSubmit={handleSaveBuilding} className="space-y-4">
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
              {buildingSaving ? "Saving…" : editingBuildingId ? "Save changes" : "Add building"}
            </Button>
          </div>
          {editingBuildingId && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">History</p>
              <HistoryPanel tableName="buildings" recordId={editingBuildingId} />
            </div>
          )}
        </form>
      </Modal>

      {/* Add / Edit room modal */}
      <Modal open={roomModalOpen} onClose={() => setRoomModalOpen(false)} title={editingRoomId ? "Edit room" : "Add room"}>
        <form onSubmit={handleSaveRoom} className="space-y-4">
          {!editingRoomId && (
            <Field label="Floor">
              <Select value={roomForm.floor_id} onChange={(e) => handleFloorChange(e.target.value)}>
                {floorsForSelected.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || `Floor ${f.floor_number}`}
                  </option>
                ))}
                <option value={NEW_FLOOR_VALUE}>+ Add a new floor…</option>
              </Select>
            </Field>
          )}

          {!editingRoomId && roomForm.floor_id === NEW_FLOOR_VALUE && (
            <div className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-border">
              <Field label="Floor number">
                <Input
                  type="number"
                  required
                  value={roomForm.new_floor_number}
                  onChange={(e) => setRoomForm({ ...roomForm, new_floor_number: e.target.value })}
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

          <Field
            label="Room number"
            hint={
              isDuplicateRoomNumber(roomForm.room_number, editingRoomId ?? undefined)
                ? undefined
                : !editingRoomId
                ? "Suggested automatically based on this floor's existing rooms — edit freely."
                : undefined
            }
          >
            <Input
              required
              placeholder="e.g. A-101"
              value={roomForm.room_number}
              onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
              className={isDuplicateRoomNumber(roomForm.room_number, editingRoomId ?? undefined) ? "border-stamp-red" : ""}
            />
            {isDuplicateRoomNumber(roomForm.room_number, editingRoomId ?? undefined) && (
              <p className="text-xs text-stamp-red mt-1">
                A room with this number already exists in this building.
              </p>
            )}
          </Field>

          <Field label="Room type" hint="Pick an existing type to keep naming consistent, or add a new one.">
            <Select
              value={roomForm.room_type_select}
              onChange={(e) => setRoomForm({ ...roomForm, room_type_select: e.target.value })}
            >
              {existingRoomTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value={NEW_TYPE_VALUE}>+ Add a new type…</option>
            </Select>
          </Field>

          {roomForm.room_type_select === NEW_TYPE_VALUE && (
            <Field label="New room type name">
              <Input
                required
                placeholder="e.g. 2-bed apartment, studio, shop"
                value={roomForm.room_type_custom}
                onChange={(e) => setRoomForm({ ...roomForm, room_type_custom: e.target.value })}
              />
            </Field>
          )}

          <Field label="Base rent (optional)" hint="A reference amount — the real rent is set per-lease.">
            <Input
              type="number"
              value={roomForm.base_rent}
              onChange={(e) => setRoomForm({ ...roomForm, base_rent: e.target.value })}
            />
          </Field>

          <Field
            label="Owner"
            hint="Leave as 'Inherit from building' unless this specific room belongs to a different owner than the rest of the building — e.g. one room sold separately."
          >
            <Select
              value={roomForm.owner_id}
              onChange={(e) => setRoomForm({ ...roomForm, owner_id: e.target.value })}
            >
              <option value="">Inherit from building</option>
              {owners?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value={NEW_OWNER_VALUE}>+ Add a new owner…</option>
            </Select>
          </Field>

          {roomForm.owner_id === NEW_OWNER_VALUE && (
            <div className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-border">
              <Field label="Owner name">
                <Input
                  required
                  value={roomForm.new_owner_name}
                  onChange={(e) => setRoomForm({ ...roomForm, new_owner_name: e.target.value })}
                />
              </Field>
              <Field label="Owner phone (optional)">
                <Input
                  value={roomForm.new_owner_phone}
                  onChange={(e) => setRoomForm({ ...roomForm, new_owner_phone: e.target.value })}
                />
              </Field>
            </div>
          )}

          {editingRoomId && (
            <Field label="Status">
              <Select
                value={roomForm.status}
                onChange={(e) => setRoomForm({ ...roomForm, status: e.target.value })}
              >
                {ROOM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {roomError && <p className="text-sm text-stamp-red">{roomError}</p>}
          <div className="flex justify-between items-center pt-2">
            <div>
              {editingRoomId && canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const room = rooms?.find((r) => r.id === editingRoomId);
                    if (room) setArchiveRoomTarget(room);
                  }}
                >
                  Archive room
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setRoomModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={roomSaving || isDuplicateRoomNumber(roomForm.room_number, editingRoomId ?? undefined)}
              >
                {roomSaving ? "Saving…" : editingRoomId ? "Save changes" : "Add room"}
              </Button>
            </div>
          </div>
          {editingRoomId && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-ink/45 mb-2">History</p>
              <HistoryPanel tableName="rooms" recordId={editingRoomId} />
            </div>
          )}
        </form>
      </Modal>

      <ConfirmModal
        open={!!archiveBuildingTarget}
        onClose={() => setArchiveBuildingTarget(null)}
        onConfirm={handleArchiveBuilding}
        title="Archive building?"
        message={`"${archiveBuildingTarget?.name}" and its rooms will be hidden from lists, but all history stays intact.`}
        confirmLabel="Archive"
        confirming={archivingBuilding}
      />

      <ConfirmModal
        open={!!archiveRoomTarget}
        onClose={() => setArchiveRoomTarget(null)}
        onConfirm={handleArchiveRoom}
        title="Archive room?"
        message={`Room "${archiveRoomTarget?.room_number}" will be hidden from lists, but its history stays intact.`}
        confirmLabel="Archive"
        confirming={archivingRoom}
      />
    </div>
  );
}
