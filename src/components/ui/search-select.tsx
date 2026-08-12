"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./field";

export type SearchSelectOption = { value: string; label: string; hint?: string };

/**
 * Searchable single select for long lists (items, suppliers). Keeps the chosen value in a
 * hidden input so it works inside a plain <form> posted to a server action.
 */
export function SearchSelect({
  name,
  options,
  defaultValue = "",
  placeholder = "เลือกรายการ",
  searchPlaceholder = "พิมพ์เพื่อค้นหา",
  emptyLabel = "ไม่พบรายการ",
  allowClear = true,
  id,
}: {
  name: string;
  options: SearchSelectOption[];
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  allowClear?: boolean;
  id?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const selected = options.find((option) => option.value === value);
  const normalised = term.trim().toLowerCase();
  const filtered = normalised
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(normalised) ||
          option.hint?.toLowerCase().includes(normalised),
      )
    : options;

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-left text-[0.95rem]"
      >
        <span className={cn("truncate", selected ? "text-ink" : "text-ink-subtle")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
      </button>

      {open ? (
        <div className="absolute z-40 mt-1 w-full rounded-[var(--radius-control)] border border-border bg-surface shadow-[var(--shadow-raised)]">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <Input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-9"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {allowClear ? (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center px-3 py-2.5 text-left text-sm text-ink-muted hover:bg-surface-muted"
                  onClick={() => {
                    setValue("");
                    setOpen(false);
                  }}
                >
                  {placeholder}
                </button>
              </li>
            ) : null}
            {filtered.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-muted"
                  onClick={() => {
                    setValue(option.value);
                    setOpen(false);
                    setTerm("");
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-xs text-ink-subtle">{option.hint}</span>
                    ) : null}
                  </span>
                  {option.value === value ? <Check className="h-4 w-4 text-brand" aria-hidden /> : null}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-ink-muted">{emptyLabel}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
