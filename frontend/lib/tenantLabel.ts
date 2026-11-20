// Owner-occupied rooms each have their OWN tenant record carrying the
// owner's name, so one owner with six rooms appears six times. This adds the
// building and room to such records so they can be told apart everywhere a
// tenant is picked or listed. Ordinary tenants keep their plain name.
type TenantLike = { full_name: string; owner_id?: string | null; owner_room_id?: string | null };
type RoomLike = { id: string; building_id: string; room_number: string };
type BuildingLike = { id: string; name: string };

export function tenantLabel(t: TenantLike, rooms: RoomLike[], buildings: BuildingLike[]): string {
  if (!t.owner_id && !t.owner_room_id) return t.full_name;
  const room = t.owner_room_id ? rooms.find((r) => r.id === t.owner_room_id) : undefined;
  if (!room) return `${t.full_name} (owner)`;
  const building = buildings.find((b) => b.id === room.building_id);
  return `${t.full_name} (owner) — ${building ? building.name + " / " : ""}${room.room_number}`;
}
