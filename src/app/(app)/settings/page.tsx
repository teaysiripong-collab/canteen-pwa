import { PageHeader } from "@/components/ui/page-header";
import {
  DocumentPrefixPanel,
  ExpiryThresholdPanel,
  NegativeStockPanel,
} from "@/features/settings/settings-panels";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/services/settings-service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePagePermission(PERMISSIONS.SETTINGS_MANAGE);
  const settings = await getSettingsSnapshot(user.organizationId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ตั้งค่า"
        description="ค่าที่แก้ได้โดยไม่ต้อง deploy ทุกการเปลี่ยนแปลงถูกบันทึกใน Audit Log ว่าใครแก้จากอะไรเป็นอะไร"
      />

      <ExpiryThresholdPanel days={settings.expiryAlertDays} />
      <DocumentPrefixPanel prefixes={settings.documentPrefixes} />
      <NegativeStockPanel allowed={settings.allowNegativeStock} />

      <p className="text-xs text-ink-subtle">
        ค่าที่ตั้งไว้ถูกตรวจด้วย schema เดียวกับตอนอ่าน ค่าที่ผิดรูปแบบจึงบันทึกไม่ได้ตั้งแต่แรก
        และถ้าแถวข้อมูลหายไป ระบบจะใช้ค่าเริ่มต้นแทนการพัง
      </p>
    </div>
  );
}
