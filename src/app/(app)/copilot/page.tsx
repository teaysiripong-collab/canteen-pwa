import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { CopilotChat } from "@/features/copilot/copilot-chat";
import { requirePageUser } from "@/lib/auth/page-guard";
import { isCopilotConfigured } from "@/lib/copilot/config";
import { toolsForUser } from "@/lib/copilot/tools";

export const dynamic = "force-dynamic";

/** Starting questions, filtered to what this user is actually allowed to see. */
const SUGGESTIONS: Array<{ text: string; tool: string }> = [
  { text: "สต็อกคงเหลือเป็นอย่างไรบ้าง", tool: "get_stock_on_hand" },
  { text: "มีรายการไหนสต็อกต่ำกว่าจุดสั่งซื้อ", tool: "get_stock_on_hand" },
  { text: "มีของอะไรใกล้หมดอายุบ้าง", tool: "get_expiring_items" },
  { text: "สัปดาห์นี้ต้องซื้ออะไรบ้าง", tool: "get_purchase_plan" },
  { text: "เดือนนี้ใช้ต้นทุนไปเท่าไร", tool: "get_daily_cost" },
  { text: "พรุ่งนี้ทำเมนูอะไร", tool: "get_menu_plan" },
];

export default async function CopilotPage() {
  const user = await requirePageUser();
  const enhancedMode = isCopilotConfigured();
  const available = toolsForUser(user);
  const allowed = new Set(available.map((tool) => tool.name));
  const suggestions = SUGGESTIONS.filter((item) => allowed.has(item.tool)).map(
    (item) => item.text,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ผู้ช่วย"
        description="ถามเรื่องสต็อก ต้นทุน แผนเมนู และการสั่งซื้อเป็นภาษาไทย ผู้ช่วยอ่านข้อมูลจริงตามสิทธิ์ของบัญชีและไม่ทำรายการแทน"
        actions={
          available.length > 0 ? (
            <StatusBadge tone="success">พร้อมใช้งาน</StatusBadge>
          ) : (
            <StatusBadge tone="muted">ยังไม่มีสิทธิ์อ่านข้อมูล</StatusBadge>
          )
        }
      />

      {!enhancedMode && available.length > 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            กำลังใช้ <strong className="text-ink">โหมดผู้ช่วยในระบบ (ฟรี)</strong> ซึ่งอ่านและสรุปข้อมูลจริงให้ได้โดยไม่เรียก API ที่คิดค่าบริการ
          </CardContent>
        </Card>
      ) : null}

      {available.length === 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลที่ผู้ช่วยเรียกได้ กรุณาติดต่อผู้ดูแลระบบ
          </CardContent>
        </Card>
      ) : (
        <CopilotChat suggestions={suggestions} />
      )}

      <p className="text-xs text-ink-subtle">
        ผู้ช่วยอ่านข้อมูลได้เฉพาะส่วนที่บัญชีของคุณมีสิทธิ์ดูอยู่แล้ว และไม่สามารถรับของ เบิกของ โอนของ หรือสั่งซื้อแทนคุณได้ ทุกธุรกรรมต้องมีคนกดยืนยันเองเพื่อให้ระบบบันทึกผู้ทำรายการ
      </p>
    </div>
  );
}
