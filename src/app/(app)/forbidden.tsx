import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** Rendered with HTTP 403 whenever a page calls `forbidden()`. */
export default function Forbidden() {
  return (
    <Card className="mt-10">
      <EmptyState
        title="คุณไม่มีสิทธิ์เข้าหน้านี้"
        description="หน้านี้จำกัดสิทธิ์ไว้เฉพาะบางบทบาท หากต้องใช้งาน กรุณาแจ้งผู้ดูแลระบบเพื่อขอสิทธิ์เพิ่ม"
        action={
          <Button asChild variant="secondary">
            <Link href="/dashboard">กลับหน้าหลัก</Link>
          </Button>
        }
      />
    </Card>
  );
}
