"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

/** One selectable "Name of unit" entry. The list comes from the server
 *  (GET /company/labels) -- the browser never invents or edits these words. */
export type UnitOption = { key: string; singular: string; plural: string };

export type UnitLabels = {
  unit_type: string;
  unit: string; // e.g. "Apartment"
  units: string; // e.g. "Apartments"
  options: UnitOption[];
};

export const DEFAULT_LABELS: UnitLabels = {
  unit_type: "apartment",
  unit: "Apartment",
  units: "Apartments",
  options: [],
};

type LabelsContextValue = { labels: UnitLabels; reload: () => Promise<void> };

export const LabelsContext = createContext<LabelsContextValue>({
  labels: DEFAULT_LABELS,
  reload: async () => {},
});

function articleFor(word: string): string {
  const w = word.toLowerCase();
  if (/^(uni|use|usu)/.test(w)) return "a"; // "a unit"
  return /^[aeiou]/.test(w) ? "an" : "a";
}

/** Mirrors apply_unit_words() in backend/app/core/labels.py. Rewrites the word
 *  "apartment" inside OUR OWN built-in text to the company's chosen word, and
 *  fixes "a"/"an" and capitalisation. Never use it on user-entered data. */
export function applyUnitWords(text: string, labels: UnitLabels): string {
  if (!text) return text;
  const singularLower = labels.unit.toLowerCase();
  const pluralLower = labels.units.toLowerCase();
  return text
    .replace(/\b(An?|an?) (apartment|Apartment)\b/g, (_m, art: string, word: string) => {
      const w = word[0] === "A" ? labels.unit : singularLower;
      const a = articleFor(w);
      return `${art[0] === "A" ? a[0].toUpperCase() + a.slice(1) : a} ${w}`;
    })
    .replace(/\b(Apartments|apartments)\b/g, (_m, w: string) => (w[0] === "A" ? labels.units : pluralLower))
    .replace(/\b(Apartment|apartment)\b/g, (_m, w: string) => (w[0] === "A" ? labels.unit : singularLower));
}

/** `L("Search apartments…")` -> "Search shops…" for a company that chose Shop. */
export function useLabels() {
  const { labels, reload } = useContext(LabelsContext);
  const L = useCallback((text: string) => applyUnitWords(text, labels), [labels]);
  return useMemo(
    () => ({
      L,
      unit: labels.unit,
      units: labels.units,
      unitLower: labels.unit.toLowerCase(),
      unitsLower: labels.units.toLowerCase(),
      options: labels.options,
      unitType: labels.unit_type,
      reload,
    }),
    [L, labels, reload]
  );
}
