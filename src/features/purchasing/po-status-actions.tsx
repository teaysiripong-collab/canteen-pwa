"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/states";
import type { PurchaseOrderStatus } from "@/schemas/purchase-order";
import { setPurchaseOrderStatusAction } from "./actions";

/** The transitions a user may drive by hand; receiving drives the rest. */
const NEXT_ACTIONS: Partial<Record<PurchaseOrderStatus, Array<{ status: PurchaseOrderStatus; label: string }>>> = {
  DRAFT: [{ status: "PENDING", label: "ส่งอนุมัติ" }],
  PENDING: [
    { status: "APPROVED", label: "อนุมัติ" },
    { status: "DRAFT", label: "ตีกลับเป็นร่าง" },
  ],
  APPROVED: [{ status: "SENT", label: "ส่งให้ผู้ขาย" }],
};

export function PurchaseOrderStatusActions({
  purchaseOrderId,
  status,
  canApprove,
  canManage,
}: {
  purchaseOrderId: string;
  status: PurchaseOrderStatus;
  canApprove: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const actions = (NEXT_ACTIONS[status] ?? []).filter((action) =>
    action.status === "APPROVED" ? canApprove : canManage,
  );

  const cancellable = canManage && ["DRAFT", "PENDING", "APPROVED", "SENT"].includes(status);

  if (actions.length === 0 && !cancellable) return null;

  const run = (next: PurchaseOrderStatus, reason?: string) => {
    setError(null);
    startTransition(async () => {
      const result = await setPurchaseOrderStatusAction({
        purchaseOrderId,
        status: next,
        reason,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.status}
            size="sm"
            loading={pending}
            onClick={() => run(action.status)}
          >
            {action.label}
          </Button>
        ))}
        {cancellable ? (
          <Button
            size="sm"
            variant="danger"
            loading={pending}
            onClick={() => run("CANCELLED", "ยกเลิกโดยผู้ใช้")}
          >
            ยกเลิกใบสั่งซื้อ
          </Button>
        ) : null}
      </div>
      {error ? <FormAlert message={error} /> : null}
    </div>
  );
}
