import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { CopilotChat } from "@/features/copilot/copilot-chat";
import { requireUser } from "@/lib/auth/session";
import { isCopilotConfigured } from "@/lib/copilot/config";
import { toolsForUser } from "@/lib/copilot/tools";

export const dynamic = "force-dynamic";

/** Starting questions, filtered to what this user is actually allowed to see. */
const SUGGESTIONS: Array<{ text: string; tool: string }> = [
  { text: "ไก่บดเหลือเท่าไร", tool: "get_stock_on_hand" },
  { text: "มีของอะไรใกล้หมดอายุบ้าง", tool: "get_expiring_items" },
  { text: "อาทิตย์นี้ต้องซื้ออะไรบ้าง", tool: "get_purchase_plan" },
  { text: "เดือนนี้ใช้ต้นทุนไปเท่าไร", tool: "get_daily_cost" },
  { text: "พรุ่งนี้ทำเมนูอะไร", tool: "get_menu_plan" },
];

export default async function CopilotPage() {
  const user = await requireUser();
  const configured = isCopilotConfigured();
  const available = toolsForUser(user);
  const allowed = new Set(available.map((tool) => tool.name));
  const suggestions = SUGGESTIONS.filter((item) => allowed.has(item.tool)).map(
    (item) => item.text,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ผู้ช่วย"
        description="ถามเรื่องสต๊อก ต้นทุน แผนเมนู และการสั่งซื้อ เป็นภาษาไทย — ผู้ช่วยอ่านข้อมูลจริงมาตอบ และทำรายการแทนไม่ได้"
        actions={
          configured ? (
            <StatusBadge tone="success">พร้อมใช้งาน</StatusBadge>
          ) : (
            <StatusBadge tone="muted">ยังไม่ได้ตั้งค่า</StatusBadge>
          )
        }
      />

      {!configured ? (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            ผู้ช่วยต้องใช้ <code className="rounded bg-surface-sunken px-1">ANTHROPIC_API_KEY</code>{" "}
            ใน environment variable จึงจะทำงานได้ ส่วนอื่นของระบบใช้งานได้ตามปกติ —
            ผู้ช่วยเป็นทางลัดในการถาม ไม่ใช่ทางเดียวที่จะเห็นข้อมูลเหล่านี้
          </CardContent>
        </Card>
      ) : available.length === 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลที่ผู้ช่วยเรียกได้ กรุณาติดต่อผู้ดูแลระบบ
          </CardContent>
        </Card>
      ) : (
        <CopilotChat suggestions={suggestions} />
      )}

      <p className="text-xs text-ink-subtle">
        ผู้ช่วยอ่านข้อมูลได้เฉพาะส่วนที่บัญชีของคุณมีสิทธิ์ดูอยู่แล้ว
        และไม่สามารถรับของ เบิกของ โอนของ หรือสั่งซื้อแทนคุณได้ — ทุกรายการต้องมีคนกดเอง
        เพื่อให้ระบบบันทึกได้ว่าใครเป็นคนทำ
      </p>
    </div>
  );
}
