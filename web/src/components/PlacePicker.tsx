import { useEffect, useId, useRef, useState } from "react";
import { autocompletePlaces } from "../api.js";
import type { Place } from "../types.js";

interface Props {
  value: Place | null;
  onSelect: (place: Place | null) => void;
  invalid?: boolean;
  describedBy?: string;
}

// A labeled combobox over /api/places/autocomplete. Debounced, keyboard
// reachable, and it clears the committed selection when the text changes so
// a stale place id can never be submitted.
export function PlacePicker({ value, onSelect, invalid, describedBy }: Props) {
  const [query, setQuery] = useState(value?.displayName ?? "");
  const [options, setOptions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const results = await autocompletePlaces(q, controller.signal);
        setOptions(results);
        setActive(-1);
      } catch {
        setOptions([]);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function choose(place: Place) {
    onSelect(place);
    setQuery(place.displayName);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="picker" ref={boxRef}>
      <input
        id="place-input"
        className={invalid ? "field invalid" : "field"}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="e.g. California"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSelect(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul className="options" id={listId} role="listbox" aria-label="Places">
          {options.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "option active" : "option"}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {p.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
