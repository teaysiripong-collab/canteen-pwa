"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "./button";
import { Input, Select } from "./field";

export type FilterOption = { value: string; label: string };

/**
 * Filters live in the URL so a filtered list can be shared, bookmarked and restored
 * after a page refresh, and so server components can read them directly.
 */
export function FilterBar({
  searchPlaceholder = "ค้นหา...",
  selects = [],
}: {
  searchPlaceholder?: string;
  selects?: Array<{ name: string; label: string; options: FilterOption[]; defaultValue?: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = React.useState(searchParams.get("q") ?? "");

  const apply = React.useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page");
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q: term.trim() });
      }}
      role="search"
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="pl-9 pr-9"
          enterKeyHint="search"
        />
        {term ? (
          <button
            type="button"
            aria-label="ล้างคำค้นหา"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
            onClick={() => {
              setTerm("");
              apply({ q: "" });
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {selects.map((select) => (
        <Select
          key={select.name}
          aria-label={select.label}
          defaultValue={searchParams.get(select.name) ?? select.defaultValue ?? ""}
          onChange={(event) => apply({ [select.name]: event.target.value })}
          className="sm:w-44"
        >
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ))}

      <Button type="submit" variant="secondary" className="sm:w-auto">
        ค้นหา
      </Button>
    </form>
  );
}
