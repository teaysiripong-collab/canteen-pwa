import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** Rendered with HTTP 401 whenever a page calls `unauthorized()`. */
export default function Unauthorized() {
  return (
    <Card className="mt-10">
      <EmptyState
        title="กรุณาเข้าสู่ระบบก่อนใช้งาน"
        description="เซสชันอาจหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้งเพื่อดำเนินการต่อ"
        action={
          <Button asChild>
            <Link href="/login">เข้าสู่ระบบ</Link>
          </Button>
        }
      />
    </Card>
  );
}
