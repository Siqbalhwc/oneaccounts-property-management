"""
Adds Unarchive support to the Tenants and Buildings/Rooms pages.

Run from the repo root (the folder containing `frontend` and `backend`):
    python apply-unarchive.py

Safe by design: every edit is an exact single-line match. If a line isn't
found (file changed since this was written) it prints a WARNING and skips
that edit instead of guessing. Each touched file is backed up as <file>.bak.
Running it twice is harmless (already-applied edits are detected).
"""
import os
import shutil
import sys

ROOT = os.getcwd()
TENANTS = os.path.join(ROOT, "frontend", "app", "(dashboard)", "tenants", "page.tsx")
BUILDINGS = os.path.join(ROOT, "frontend", "app", "(dashboard)", "buildings", "page.tsx")


def patch(path, edits):
    if not os.path.exists(path):
        print(f"WARNING: not found: {path}")
        return
    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()
    original = text
    for name, anchor, replacement, marker in edits:
        if marker in text:
            print(f"  [skip] {name}: already applied")
            continue
        count = text.count(anchor)
        if count != 1:
            print(f"  WARNING {name}: anchor found {count}x (expected 1) - skipped")
            continue
        text = text.replace(anchor, replacement, 1)
        print(f"  [ok]   {name}")
    if text != original:
        shutil.copyfile(path, path + ".bak")
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        print(f"  saved {os.path.relpath(path, ROOT)} (backup: .bak)")


print("Tenants page")
patch(TENANTS, [
    (
        "handler",
        "  async function handleArchive() {",
        """  async function handleUnarchive(t: Tenant) {
    await api.post(`/tenants/${t.id}/unarchive`, {});
    load();
  }

  async function handleArchive() {""",
        "handleUnarchive",
    ),
    (
        "button",
        "{canManage && !t.is_archived && (",
        """{canManage && t.is_archived && (
                    <Button variant="ghost" onClick={() => handleUnarchive(t)}>
                      Unarchive
                    </Button>
                  )}
                  {canManage && !t.is_archived && (""",
        "handleUnarchive(t)}>",
    ),
])

print("Buildings page")
patch(BUILDINGS, [
    (
        "state",
        '  const [roomStatusFilter, setRoomStatusFilter] = useState("");',
        '  const [roomStatusFilter, setRoomStatusFilter] = useState("");\n  const [showArchived, setShowArchived] = useState(false);',
        "setShowArchived] = useState",
    ),
    (
        "load buildings",
        'api.get<Building[]>("/buildings").then((data) => {',
        'api.get<Building[]>(`/buildings${showArchived ? "?include_archived=true" : ""}`).then((data) => {',
        "/buildings${showArchived",
    ),
    (
        "load rooms",
        'api.get<RoomWithOwner[]>("/rooms").then(setRooms);',
        'api.get<RoomWithOwner[]>(`/rooms${showArchived ? "?include_archived=true" : ""}`).then(setRooms);',
        "/rooms${showArchived",
    ),
    (
        "reload effect",
        '  const canManage = myRole === "owner" || myRole === "admin";',
        """  const canManage = myRole === "owner" || myRole === "admin";

  useEffect(() => {
    loadBuildings();
    loadRoomsAndFloors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);""",
        "}, [showArchived]);",
    ),
    (
        "handlers",
        "  async function handleArchiveBuilding() {",
        """  async function handleUnarchiveBuilding(id: string) {
    await api.post(`/buildings/${id}/unarchive`, {});
    loadBuildings();
  }

  async function handleUnarchiveRoom(id: string) {
    await api.post(`/rooms/${id}/unarchive`, {});
    setRoomModalOpen(false);
    loadRoomsAndFloors();
  }

  async function handleArchiveBuilding() {""",
        "handleUnarchiveBuilding(id",
    ),
    (
        "toggle",
        '<div className="flex gap-2 flex-wrap no-print">',
        """<div className="flex gap-2 flex-wrap no-print">
          <label className="flex items-center gap-2 text-xs text-ink/50 self-center">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>""",
        "setShowArchived(e.target.checked)",
    ),
    (
        "unarchive building button",
        "{canManage && (",
        """{canManage && (selectedBuilding as any).is_archived && (
                <Button variant="ghost" onClick={() => handleUnarchiveBuilding(selectedBuilding.id)}>
                  Unarchive building
                </Button>
              )}
              {canManage && (""",
        "Unarchive building",
    ),
    (
        "archived badge on room tile",
        '<p className="text-xs text-ink/50">{room.room_type ?? "Unit"}</p>',
        """<p className="text-xs text-ink/50">{room.room_type ?? "Unit"}</p>
                {(room as any).is_archived && <p className="text-[10px] text-stamp-red mt-1">Archived</p>}""",
        "(room as any).is_archived",
    ),
    (
        "unarchive room button",
        "{editingRoomId && canManage && (",
        """{editingRoomId && canManage && (rooms?.find((r) => r.id === editingRoomId) as any)?.is_archived && (
                <Button type="button" variant="ghost" onClick={() => handleUnarchiveRoom(editingRoomId)}>
                  Unarchive room
                </Button>
              )}
              {editingRoomId && canManage && (""",
        "Unarchive room",
    ),
])

print("\nDone. Run `git diff` to review, then commit and push.")
