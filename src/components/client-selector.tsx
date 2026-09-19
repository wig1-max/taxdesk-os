"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchClientsAction } from "@/app/actions/clients";
import type { ClientSearchOption } from "@/lib/clients/client-search";
import { Label } from "@/components/ui/label";
import { clampActiveIndex, comboboxKeyAction } from "@/lib/ui/combobox-nav";
import { cn } from "@/lib/utils";

/**
 * Searchable client picker for New Case (`K3-ENV-4`).
 *
 * Replaces a `<select>` that rendered only the first 500 clients ordered by
 * name. That cap was a real correctness bug, not just a test nuisance: an office
 * with more than 500 clients could not select the ones outside the window at
 * all, and there was no feedback that anything had been omitted. Search runs
 * server-side, so the number of clients no longer affects whether one is
 * reachable.
 *
 * WAI-ARIA 1.2 combobox with a listbox popup. All keyboard decisions come from
 * the pure, unit-tested {@link comboboxKeyAction}; this component is the DOM
 * wrapper. The committed id travels in a hidden input, so the surrounding form
 * keeps reading `client_id` from `FormData` exactly as it did with the select.
 */
export function ClientSelector({
  initialOptions,
  presetClient,
  name = "client_id",
  label = "Client *",
}: {
  initialOptions: ClientSearchOption[];
  presetClient?: ClientSearchOption;
  name?: string;
  label?: string;
}) {
  const inputId = useId();
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const [selected, setSelected] = useState<ClientSearchOption | null>(presetClient ?? null);
  const [term, setTerm] = useState(presetClient?.label ?? "");
  const [options, setOptions] = useState<ClientSearchOption[]>(initialOptions);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic id so a slow earlier response can never overwrite a newer one.
  const requestSeq = useRef(0);
  // The committed label; typing away from it must clear the selection.
  const committedLabel = selected?.label ?? null;

  useEffect(() => {
    if (!open) return;
    if (committedLabel !== null && term === committedLabel) return;
    const seq = ++requestSeq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      searchClientsAction(term)
        .then((next) => {
          if (seq !== requestSeq.current) return; // a newer search already won
          setOptions(next);
          setActiveIndex((i) => clampActiveIndex(i, next.length));
        })
        .finally(() => {
          if (seq === requestSeq.current) setSearching(false);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [term, open, committedLabel]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function commit(index: number) {
    const choice = options[index];
    if (!choice) return;
    setSelected(choice);
    setTerm(choice.label);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const action = comboboxKeyAction({
      key: e.key,
      open,
      activeIndex,
      count: options.length,
    });
    if (action.kind === "none") return;
    // Tab closes the popup but must keep moving focus, so it is never swallowed.
    if (e.key !== "Tab") e.preventDefault();

    if (action.kind === "open") {
      setOpen(true);
      setActiveIndex(action.activeIndex);
    } else if (action.kind === "move") {
      setActiveIndex(action.activeIndex);
    } else if (action.kind === "commit") {
      commit(action.index);
    } else {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="space-y-1" ref={rootRef}>
      <Label htmlFor={inputId}>{label}</Label>
      {/* The form still reads a plain `client_id` field. */}
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          aria-describedby={`${inputId}-help`}
          autoComplete="off"
          value={term}
          placeholder="Search by name or phone…"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(e) => {
            setTerm(e.target.value);
            // Typing away from the committed label clears the selection, so the
            // form can never submit an id that no longer matches what is shown.
            if (selected && e.target.value !== selected.label) setSelected(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Client search results"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card shadow-elev-2"
          >
            {options.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground" role="presentation">
                {searching ? "Searching…" : "No matching client."}
              </li>
            )}
            {options.map((o, i) => (
              <li
                key={o.id}
                id={optionId(i)}
                role="option"
                aria-selected={selected?.id === o.id}
                // 44px minimum pointer target (K.2.9.6).
                className={cn(
                  "flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm",
                  i === activeIndex && "bg-accent",
                )}
                onMouseEnter={() => setActiveIndex(i)}
                // `mousedown` fires before the input's blur, so the click is not
                // lost to the outside-pointer handler closing the popup.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(i);
                }}
              >
                {o.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
        {selected
          ? "Client selected."
          : "Type to search all clients. Select one to continue."}
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {open ? `${options.length} client${options.length === 1 ? "" : "s"} listed` : ""}
      </span>
    </div>
  );
}
