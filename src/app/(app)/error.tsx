"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server guards throw AppError; its message is already a safe Thai sentence.
  const message =
    error.message && !error.message.startsWith("An error occurred in the Server Components")
      ? error.message
      : "ไม่สามารถโหลดหน้านี้ได้ กรุณาลองใหม่อีกครั้ง";

  return (
    <div className="py-10">
      <ErrorState
        title="เกิดข้อผิดพลาด"
        description={message}
        action={
          <Button variant="secondary" onClick={reset}>
            ลองใหม่
          </Button>
        }
      />
    </div>
  );
}
