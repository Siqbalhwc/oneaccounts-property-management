"use client";

import { createContext, useContext } from "react";

/** What the logged-in user may do -- from GET /access/me. `null` while it is
 *  loading (or if the call failed): everything stays visible, and the server
 *  still enforces the real rules, so a slow/failed call can never lock anyone
 *  out or, worse, leak anything. */
export type AccessInfo = {
  role: string;
  role_label: string;
  is_platform_admin: boolean;
  access_control_enabled: boolean;
  scoped: boolean;
  building_ids: string[];
  can_manage_users: boolean;
  effective_role: "owner" | "admin" | "accountant" | "auditor";
  can_view_statements: boolean;
  can_post_entries: boolean;
  can_manage_master_data: boolean;
  can_use_data_transfer: boolean;
  read_only: boolean;
  // Roommates / facility specs (optional so an older API response still type-checks).
  can_add_roommates?: boolean;
  can_edit_roommates?: boolean;
  can_remove_roommates?: boolean;
  can_manage_facilities?: boolean;
};

export const AccessContext = createContext<AccessInfo | null>(null);
export const useAccess = () => useContext(AccessContext);
