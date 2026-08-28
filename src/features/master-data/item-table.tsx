"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { ActiveBadge } from "@/components/ui/status-badge";
import { formatQty } from "@/lib/quantity";

export type ItemRow = {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  isActive: boolean;
  minimumStock: string;
  reorderPoint: string;
  categoryName: string | null;
  baseUnitCode: string | null;
  supplierName: string | null;
};

const columns: ColumnDef<ItemRow, unknown>[] = [
  { accessorKey: "code", header: "รหัส" },
  {
    accessorKey: "nameTh",
    header: "ชื่อวัตถุดิบ",
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-ink">{row.original.nameTh}</p>
        {row.original.nameEn ? <p className="text-xs text-ink-subtle">{row.original.nameEn}</p> : null}
      </div>
    ),
  },
  { accessorKey: "categoryName", header: "หมวดหมู่", cell: ({ getValue }) => (getValue() as string) ?? "-" },
  { accessorKey: "baseUnitCode", header: "หน่วยหลัก", cell: ({ getValue }) => (getValue() as string) ?? "-" },
  {
    accessorKey: "reorderPoint",
    header: "จุดสั่งซื้อ",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatQty(row.original.reorderPoint)} {row.original.baseUnitCode ?? ""}
      </span>
    ),
  },
  { accessorKey: "supplierName", header: "ผู้ขายหลัก", cell: ({ getValue }) => (getValue() as string) ?? "-" },
  {
    accessorKey: "isActive",
    header: "สถานะ",
    cell: ({ row }) => <ActiveBadge isActive={row.original.isActive} />,
  },
];

export function ItemTable({ rows }: { rows: ItemRow[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyTitle="ไม่พบรายการสินค้า"
      emptyDescription="ลองเปลี่ยนคำค้นหา หรือเพิ่มวัตถุดิบใหม่"
      onRowClick={(row) => router.push(`/items/${row.id}`)}
    />
  );
}
