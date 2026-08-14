"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { openCountAction } from "./actions";

export function OpenCountButton({
  locations,
  defaultLocationId,
}: {
  locations: Array<{ id: string; code: string; nameTh: string }>;
  defaultLocationId: string | null;
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () => {
    setError(null);
    startTransition(async () => {
      const result = await openCountAction({ locationId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/inventory/count/${result.data.sessionId}`);
    });
  };

  if (locations.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Select
          aria-label="สถานที่ที่จะตรวจนับ"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          className="w-52"
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} · {location.nameTh}
            </option>
          ))}
        </Select>
        <Button loading={pending} onClick={open}>
          เปิดใบตรวจนับ
        </Button>
      </div>
      {error ? <FormAlert message={error} /> : null}
    </div>
  );
}
