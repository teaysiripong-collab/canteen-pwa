import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StockCard } from "@/components/ui/cards";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { listStockBalances, listStockLocations } from "@/repositories/inventory-repository";
import type { StatusTone } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

/** Stock status is shown as icon + words, never colour alone. */
function stockStatus(
  baseQty: string,
  minimumStock: string,
  reorderPoint: string,
): { tone: StatusTone; label: string } {
  const qty = Number(baseQty);

  if (qty <= 0) return { tone: "critical", label: "หมด" };
  if (qty <= Number(minimumStock)) return { tone: "critical", label: "ต่ำกว่าขั้นต่ำ" };
  if (qty <= Number(reorderPoint)) return { tone: "warning", label: "ถึงจุดสั่งซื้อ" };
  return { tone: "success", label: "ปกติ" };
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : undefined;
  const locationId = typeof params.location === "string" ? params.location : undefined;
  const view = typeof params.view === "string" ? params.view : "all";

  const [locationOptions, rows] = await Promise.all([
    listStockLocations(user.organizationId),
    listStockBalances(user.organizationId, {
      q,
      locationId,
      onlyInStock: view !== "low",
      onlyBelowReorder: view === "low",
    }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="สต๊อกคงเหลือ"
        description={`${rows.length} รายการ · ยอดคงเหลือคำนวณจากบัญชีเคลื่อนไหวทั้งหมด`}
      />

      <FilterBar
        searchPlaceholder="ค้นหาด้วยรหัสหรือชื่อวัตถุดิบ"
        selects={[
          {
            name: "location",
            label: "สถานที่",
            options: [
              { value: "", label: "ทุกสถานที่" },
              ...locationOptions.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.nameTh}`,
              })),
            ],
          },
          {
            name: "view",
            label: "มุมมอง",
            defaultValue: "all",
            options: [
              { value: "all", label: "มีของในสต๊อก" },
              { value: "low", label: "ของใกล้หมด" },
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={view === "low" ? "ไม่มีของใกล้หมด" : "ยังไม่มีสต๊อก"}
            description={
              view === "low"
                ? "ทุกรายการยังสูงกว่าจุดสั่งซื้อ"
                : "เมื่อรับสินค้าเข้าระบบ ยอดคงเหลือจะแสดงที่นี่"
            }
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const status = stockStatus(row.baseQty, row.minimumStock, row.reorderPoint);
            return (
              <StockCard
                key={`${row.itemId}:${row.locationId}`}
                href={`/inventory/stock/${row.itemId}?location=${row.locationId}`}
                itemName={row.itemNameTh}
                itemCode={`${row.itemCode} · ${row.locationCode} · ${row.lotCount} ลอต`}
                quantity={row.baseQty}
                unit={row.baseUnitCode ?? ""}
                tone={status.tone}
                statusLabel={`${status.label} · จุดสั่งซื้อ ${formatQty(row.reorderPoint)}`}
              />
            );
          })}
        </div>
      )}

      <p className="text-sm text-ink-muted">
        ต้องการดูประวัติการเคลื่อนไหวทั้งหมด?{" "}
        <Link href="/inventory/movements" className="text-brand underline-offset-4 hover:underline">
          เปิดบัญชีเคลื่อนไหวสต๊อก
        </Link>
      </p>
    </div>
  );
}
