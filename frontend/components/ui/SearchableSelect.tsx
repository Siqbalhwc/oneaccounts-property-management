"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ComboOption = {
  value: string;
  label: string;
};

/**
 * A type-to-filter dropdown, styled to match the app's plain <Select>.
 * Used anywhere a list is long enough that scrolling through a native
 * <select> is slow -- chart of accounts, tenants, owners, buildings, etc.
 *
 * The option panel is rendered through a React portal directly into
 * document.body rather than as a normal absolutely-positioned child.
 * This matters specifically because this component gets used inside
 * horizontally-scrolling containers (e.g. the journal entry table's
 * `overflow-x-auto` wrapper) -- per the CSS overflow spec, setting
 * overflow-x to a non-visible value forces the computed overflow-y to
 * become non-visible too, which would silently clip a normal dropdown
 * panel that tries to open below the visible table area. Portalling
 * to <body> and positioning with getBoundingClientRect sidesteps that
 * entirely, the same way libraries like Radix/Floating UI handle it.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search…",
  disabled = false,
  className = "",
  emptyLabel = "No matches",
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function updatePosition() {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPanelStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 220),
      zIndex: 1000,
    });
  }

  function openPanel() {
    if (disabled) return;
    updatePosition();
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;

    function handleScrollOrResize() {
      updatePosition();
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideInput = inputRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideInput && !insidePanel) closePanel();
    }

    // capture:true on scroll so this also fires for scrolling inside the
    // journal table's own horizontal scroll container, not just the window.
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  function selectOption(opt: ComboOption) {
    onChange(opt.value);
    closePanel();
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) selectOption(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
      inputRef.current?.blur();
    }
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={openPanel}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        className="w-full px-3 py-2 pr-7 text-sm bg-paper-card border border-border rounded-card text-ink placeholder:text-ink/35 focus:border-brass-dark focus:ring-1 focus:ring-brass-dark outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed truncate"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 text-[10px]">
        ▾
      </span>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="bg-paper-card border border-border rounded-card shadow-card max-h-56 overflow-y-auto scrollbar-thin"
          >
            {filtered.length === 0 && (
              <div className="px-3 py-2.5 text-xs text-ink/40 text-center">{emptyLabel}</div>
            )}
            {filtered.map((opt, i) => (
              <div
                key={opt.value || "__empty__"}
                onMouseDown={(e) => {
                  // preventDefault stops the input from blurring before this
                  // click is registered -- without it, the panel would close
                  // (via handleClickOutside/blur) before selectOption runs.
                  e.preventDefault();
                  selectOption(opt);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`px-3 py-2 text-sm cursor-pointer truncate ${
                  i === activeIndex ? "bg-ledger/[0.07]" : ""
                } ${opt.value === value ? "font-medium text-ledger" : "text-ink"}`}
              >
                {opt.label}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
