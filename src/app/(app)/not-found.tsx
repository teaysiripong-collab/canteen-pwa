import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <Card className="mt-10">
      <EmptyState
        title="ไม่พบหน้าที่ต้องการ"
        description="หน้านี้อาจถูกย้าย หรือข้อมูลถูกลบไปแล้ว"
        action={
          <Button asChild variant="secondary">
            <Link href="/dashboard">กลับหน้าหลัก</Link>
          </Button>
        }
      />
    </Card>
  );
}
