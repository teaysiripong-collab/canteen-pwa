"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DatePicker, Label, Select } from "@/components/ui/field";

export type SelectFilter = {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
};

export type DateFilter = { name: string; label: string; value: string };

/**
 * Cost reports are always "which window, which place". Both live in the URL so a report a
 * supervisor is looking at can be pasted into chat and open on the same numbers.
 */
export function CostFilters({
  dates = [],
  selects = [],
}: {
  dates?: DateFilter[];
  selects?: SelectFilter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const apply = React.useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "") params.delete(name);
      else params.set(name, value);
      params.delete("page");
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {dates.map((date) => (
        <div key={date.name} className="flex flex-col gap-1.5">
          <Label htmlFor={`filter-${date.name}`}>{date.label}</Label>
          <DatePicker
            id={`filter-${date.name}`}
            defaultValue={date.value}
            onChange={(event) => apply(date.name, event.target.value)}
          />
        </div>
      ))}

      {selects.map((select) => (
        <div key={select.name} className="flex flex-col gap-1.5">
          <Label htmlFor={`filter-${select.name}`}>{select.label}</Label>
          <Select
            id={`filter-${select.name}`}
            defaultValue={searchParams.get(select.name) ?? ""}
            onChange={(event) => apply(select.name, event.target.value)}
          >
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}
