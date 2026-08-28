"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/states";
import { setUserActiveAction } from "./actions";

/**
 * Accounts are deactivated, never deleted — the audit trail and every document they
 * created must keep pointing at a real user row.
 */
export function UserActiveToggle({ userId, isActive }: { userId: string; isActive: boolean }) {
  const [state, formAction, pending] = useActionState(setUserActiveAction, undefined);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={userId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button type="submit" variant={isActive ? "danger" : "secondary"} size="sm" loading={pending}>
        {isActive ? "ปิดใช้งานบัญชี" : "เปิดใช้งานบัญชี"}
      </Button>
      {state && !state.ok ? <FormAlert message={state.message} /> : null}
    </form>
  );
}
