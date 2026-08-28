"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { openDraftVersionAction } from "./actions";

/**
 * Editing a published recipe never edits it — it opens the next version, copied from the
 * current one. The button says so, because that is the rule the kitchen has to understand.
 */
export function OpenDraftButton({
  menuId,
  hasPublished,
}: {
  menuId: string;
  hasPublished: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await openDraftVersionAction(menuId);
          if (result.ok) {
            router.push(`/menu/recipes/${menuId}/${result.data.recipeVersionId}`);
            router.refresh();
          }
        })
      }
    >
      {hasPublished ? "แก้ไข (สร้างเวอร์ชันใหม่)" : "สร้างสูตร"}
    </Button>
  );
}
