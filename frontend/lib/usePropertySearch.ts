"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

// Room / apartment / building search for any list page.
//
// All the matching happens on the server (GET /property-search/{entity}); this
// hook only asks "which of my <entity> records belong to what the user typed?"
// and hands back their ids (plus optional short notes, e.g. "Past tenant ·
// Sunrise — Apartment 101"). A page keeps its own text search and shows a
// record when EITHER its own search or this one matches.
//
// If the request fails, the page silently falls back to its own search.

type Result = { ids: Set<string>; notes: Record<string, string>; loading: boolean };

const NO_IDS: Set<string> = new Set();
const NO_NOTES: Record<string, string> = {};

export function usePropertySearch(entity: string, term: string, delayMs = 350): Result {
  const trimmed = term.trim();
  const [loaded, setLoaded] = useState<{ key: string; ids: Set<string>; notes: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trimmed) {
      setLoaded(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get<{ ids: string[]; notes?: Record<string, string> }>(
          `/property-search/${entity}?q=${encodeURIComponent(trimmed)}`
        )
        .then((res) => {
          if (!cancelled) setLoaded({ key: trimmed, ids: new Set(res.ids), notes: res.notes ?? {} });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ key: trimmed, ids: new Set(), notes: {} });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entity, trimmed, delayMs]);

  // Ignore results that belong to an older search term.
  const fresh = loaded !== null && loaded.key === trimmed;
  return { ids: fresh ? loaded!.ids : NO_IDS, notes: fresh ? loaded!.notes : NO_NOTES, loading };
}
