"use client";

/**
 * ⌘K / Ctrl-K command palette.
 *
 * The platform has ~50 routes across four portals; a flat navbar cannot expose
 * that without becoming unusable. This gives every feature a two-keystroke
 * path regardless of where the user currently is.
 *
 * Accessibility: rendered as an ARIA combobox + listbox. The input keeps DOM
 * focus the whole time and the active option is advertised via
 * aria-activedescendant, so arrow keys move the selection without ever moving
 * focus away from the text field (the pattern screen readers expect).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./LucideIcon";
import { searchItems, ALL_ITEMS } from "@/lib/navigation";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const results = useMemo(
    () => (query.trim() ? searchItems(query) : ALL_ITEMS),
    [query]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    // Return focus to whatever opened the palette (WCAG 2.4.3).
    restoreFocusTo.current?.focus();
  }, []);

  // Global open shortcut + a custom event so the navbar button can open it too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        restoreFocusTo.current = document.activeElement as HTMLElement;
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen((o) => (o ? false : o));
    }
    function onOpen() {
      restoreFocusTo.current = document.activeElement as HTMLElement;
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("cmdk:open", onOpen as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cmdk:open", onOpen as EventListener);
    };
  }, []);

  // Focus the field on open and lock background scroll.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit.href);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onMouseDown={close} role="presentation">
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search features"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdk-inputRow">
          <Icon name="search" size={18} strokeWidth={1.9} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search every feature — try “verify”, “seating”, “emergency”…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `cmdk-opt-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className="cmdk-empty">
            Nothing matches “{query}”. Try a role, a feature, or a concept like “merkle”.
          </p>
        ) : (
          <ul className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef} aria-label="Results">
            {results.map((r, i) => (
              <li key={`${r.href}-${r.title}`} role="none">
                <button
                  id={`cmdk-opt-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk-item${i === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.href)}
                  type="button"
                >
                  <span className="cmdk-itemIcon">
                    <Icon name={r.icon} size={16} strokeWidth={1.8} />
                  </span>
                  <span className="cmdk-itemText">
                    <span className="cmdk-itemTitle">
                      {r.title}
                      {r.auth && (
                        <span className="cmdk-lock" title="Requires sign in">
                          <Icon name="lock" size={11} strokeWidth={2} />
                        </span>
                      )}
                    </span>
                    <span className="cmdk-itemDesc">{r.desc}</span>
                  </span>
                  <span className="cmdk-itemGroup">{r.group}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          <span className="cmdk-count">{results.length} of {ALL_ITEMS.length}</span>
        </div>
      </div>
    </div>
  );
}
