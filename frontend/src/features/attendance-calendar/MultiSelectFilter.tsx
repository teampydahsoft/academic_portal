"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Option = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  allLabel: string;
  options: Option[];
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

export function MultiSelectFilter({
  label,
  allLabel,
  options,
  values,
  onChange,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const selectedSet = new Set(values);
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const summary =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? values[0]
        : `${values.length} selected`;

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }
    onChange([...values, value]);
  }

  function clearAll() {
    onChange([]);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-left text-sm outline-none transition-colors",
          open ? "border-navy-800 ring-1 ring-navy-800/20" : "border-border hover:border-slate-300",
          disabled && "cursor-not-allowed opacity-60",
          values.length > 0 ? "text-navy-900" : "text-slate-500",
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {values.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800"
            >
              <span className="truncate">{value}</span>
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => toggle(value)}
                className="rounded-full p-0.5 hover:bg-sky-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-white shadow-lg"
        >
          <div className="border-b border-border p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-navy-800"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] font-medium text-slate-500 hover:text-navy-900"
            >
              {allLabel}
            </button>
            <span className="text-[11px] text-slate-400">
              {values.length}/{options.length}
            </span>
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">No matches</li>
            ) : (
              filtered.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => toggle(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                        checked && "bg-sky-50/70",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-navy-800 bg-navy-800 text-white"
                            : "border-slate-300 bg-white",
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="truncate text-slate-700">{option.label}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
