"use client";

import { createContext, useContext } from "react";

/** Keys of the optional plug-ins switched on for this company (from GET /company/plugins).
 *  Empty while loading or if the call fails, so a plug-in's screens simply stay hidden. */
export const PluginsContext = createContext<string[]>([]);
export const usePlugins = () => useContext(PluginsContext);
