"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { getStockLevels } from "@/lib/stock";
import { getConfig } from "@/lib/config";
import type { PoStatus } from "@prisma/client";

async function requireEdit() {
  const s = await requireSession();
  if (!can(s.role, "purchase", "edit")) throw new Error("FORBIDDEN");
  return s;
}

async function nextPoCode(): Promise<string> {
  const { poPrefix } = await getConfig();
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await db.purchaseOrder.count({ where: { code: { startsWith: `${poPrefix}-${ymd}` } } });
  return `${poPrefix}-${ymd}-${String(count + 1).padStart(3, "0")}`;
}

/** Generate draft POs from BOM for a date range, grouped by default vendor. */
export async function generatePOs(from: string, to: string) {
  const s = await requireEdit();
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");

  const lines = await db.bomLine.findMany({
    where: { planEntry: { date: { gte: fromD, lte: toD } } },
    include: { ingredient: true },
  });
  if (lines.length === 0) throw new Error("ไม่มี BOM ในช่วงวันที่เลือก");

  // Aggregate BOM per ingredient
  const bomByIng = new Map<string, number>();
  for (const l of lines) {
    bomByIng.set(l.ingredientId, (bomByIng.get(l.ingredientId) ?? 0) + Number(l.qty));
  }

  // Already ordered in overlapping-period POs (reference)
  const existing = await db.purchaseOrderItem.findMany({
    where: {
      po: {
        status: { notIn: ["CANCELLED"] },
        periodStart: { lte: toD },
        periodEnd: { gte: fromD },
      },
    },
  });
  const orderedByIng = new Map<string, number>();
  for (const it of existing) {
    orderedByIng.set(it.ingredientId, (orderedByIng.get(it.ingredientId) ?? 0) + Number(it.orderQty));
  }

  const stock = await getStockLevels();
  const stockByIng = new Map(stock.map((x) => [x.ingredientId, x.total]));

  // Group by default vendor
  const ingredients = await db.ingredient.findMany({ where: { id: { in: [...bomByIng.keys()] } } });
  const byVendor = new Map<string, typeof ingredients>();
  for (const ing of ingredients) {
    const vId = ing.defaultVendorId ?? "NONE";
    if (!byVendor.has(vId)) byVendor.set(vId, []);
    byVendor.get(vId)!.push(ing);
  }

  const created: string[] = [];
  for (const [vendorId, ings] of byVendor) {
    if (vendorId === "NONE") continue; // ตรวจจับใน validation: วัตถุดิบไม่มี vendor
    const code = await nextPoCode();
    const po = await db.purchaseOrder.create({
      data: {
        code, vendorId, status: "DRAFT", periodStart: fromD, periodEnd: toD, createdById: s.userId,
        items: {
          create: ings.map((ing) => {
            const bom = bomByIng.get(ing.id) ?? 0;
            const stk = stockByIng.get(ing.id) ?? 0;
            const ordered = orderedByIng.get(ing.id) ?? 0;
            const suggested = Math.max(0, Math.round((bom - stk - ordered) * 100) / 100);
            return {
              ingredientId: ing.id,
              bomQty: Math.round(bom * 100) / 100,
              stockQty: Math.round(stk * 100) / 100, // snapshot อ้างอิงเท่านั้น
              suggestedQty: suggested,
              orderQty: suggested, // ค่าเริ่มต้น — คนแก้เองได้เสมอ
              unitId: ing.stockUnitId,
              price: ing.lastPrice,
            };
          }),
        },
      },
    });
    created.push(po.id);
    await audit({ userId: s.userId, entity: "PurchaseOrder", entityId: po.id, action: "CREATE", detail: `สร้าง ${code} จาก BOM ${from} ถึง ${to}` });
  }
  revalidatePath("/purchase");
  redirect("/purchase?created=" + created.length);
}

export async function updatePoItem(itemId: string, formData: FormData) {
  const s = await requireEdit();
  const item = await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId }, include: { ingredient: true } });
  const orderQty = parseFloat(String(formData.get("orderQty")));
  const priceRaw = String(formData.get("price") ?? "").trim();
  const data: { orderQty?: number; price?: number } = {};
  if (Number.isFinite(orderQty) && orderQty >= 0) data.orderQty = orderQty;
  if (priceRaw !== "") {
    const price = parseFloat(priceRaw);
    if (Number.isFinite(price) && price >= 0) data.price = price;
  }
  await db.purchaseOrderItem.update({ where: { id: itemId }, data });
  if (data.orderQty !== undefined && data.orderQty !== Number(item.orderQty)) {
    await audit({ userId: s.userId, entity: "PurchaseOrderItem", entityId: itemId, action: "UPDATE", field: "orderQty", oldValue: Number(item.orderQty), newValue: data.orderQty, detail: item.ingredient.name });
  }
  if (data.price !== undefined && data.price !== Number(item.price ?? 0)) {
    await audit({ userId: s.userId, entity: "PurchaseOrderItem", entityId: itemId, action: "UPDATE", field: "price", oldValue: item.price ? Number(item.price) : null, newValue: data.price, detail: item.ingredient.name });
    // เก็บราคาล่าสุดไว้ที่ Master เพื่อใช้ประเมิน Cost ครั้งถัดไป
    await db.ingredient.update({ where: { id: item.ingredientId }, data: { lastPrice: data.price } });
  }
  revalidatePath(`/purchase/${item.poId}`);
}

const FLOW: PoStatus[] = ["DRAFT", "REVIEWED", "APPROVED", "ORDERED", "PARTIAL", "RECEIVED", "COMPLETED"];

export async function setPoStatus(poId: string, status: PoStatus, overrideReason?: string) {
  const s = await requireSession();
  const needApprove = status === "APPROVED" || status === "COMPLETED";
  if (!can(s.role, "purchase", needApprove ? "approve" : "edit")) throw new Error("FORBIDDEN");
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  if (status !== "CANCELLED" && FLOW.indexOf(status) < FLOW.indexOf(po.status)) {
    throw new Error("ย้อนสถานะไม่ได้");
  }
  await db.purchaseOrder.update({
    where: { id: poId },
    data: {
      status,
      ...(status === "ORDERED" ? { orderDate: new Date() } : {}),
      ...(overrideReason ? { overrideReason } : {}),
    },
  });
  await audit({
    userId: s.userId, entity: "PurchaseOrder", entityId: poId,
    action: overrideReason ? "OVERRIDE" : "STATUS",
    oldValue: po.status, newValue: status,
    detail: overrideReason ? `Override: ${overrideReason}` : undefined,
  });
  revalidatePath(`/purchase/${poId}`);
  revalidatePath("/purchase");
}

export async function confirmOrderWithOverride(poId: string, formData: FormData) {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("ต้องระบุเหตุผลในการ Override");
  await setPoStatus(poId, "ORDERED", reason);
}

/** เปลี่ยน Vendor ของรายการ: ย้ายไป Draft PO ของ Vendor ใหม่ (ช่วงเดียวกัน) */
export async function moveItemToVendor(itemId: string, formData: FormData) {
  const s = await requireEdit();
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!vendorId) throw new Error("เลือก Vendor");
  const item = await db.purchaseOrderItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { po: true, ingredient: true },
  });
  let target = await db.purchaseOrder.findFirst({
    where: { vendorId, status: "DRAFT", periodStart: item.po.periodStart, periodEnd: item.po.periodEnd },
  });
  if (!target) {
    target = await db.purchaseOrder.create({
      data: {
        code: await nextPoCode(), vendorId, status: "DRAFT",
        periodStart: item.po.periodStart, periodEnd: item.po.periodEnd, createdById: s.userId,
      },
    });
  }
  await db.purchaseOrderItem.update({ where: { id: itemId }, data: { poId: target.id } });
  await audit({ userId: s.userId, entity: "PurchaseOrderItem", entityId: itemId, action: "UPDATE", field: "vendor", detail: `ย้าย ${item.ingredient.name} ไป PO ${target.code}` });
  revalidatePath(`/purchase/${item.poId}`);
  revalidatePath("/purchase");
}

/** รับของตาม PO: สร้าง Lot + Stock RECEIVE + update receivedQty + สถานะ PARTIAL/RECEIVED */
export async function receivePoItems(poId: string, formData: FormData) {
  const s = await requireSession();
  if (!can(s.role, "stock", "edit")) throw new Error("FORBIDDEN");
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: { items: { include: { ingredient: true } } },
  });
  const locationId = String(formData.get("locationId") ?? "");
  if (!locationId) throw new Error("เลือก Location");
  const note = String(formData.get("note") ?? "");

  let receivedAny = false;
  for (const item of po.items) {
    const qty = parseFloat(String(formData.get(`qty_${item.id}`) ?? ""));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const lotCode = String(formData.get(`lot_${item.id}`) ?? "").trim() || `LOT-${po.code}-${item.ingredient.code}`;
    const expiryRaw = String(formData.get(`exp_${item.id}`) ?? "").trim();
    const lot = await db.lot.create({
      data: {
        ingredientId: item.ingredientId, lotCode,
        expiryDate: expiryRaw ? new Date(expiryRaw + "T00:00:00Z") : null,
        vendorId: po.vendorId,
      },
    });
    await db.stockTransaction.create({
      data: {
        type: "RECEIVE", ingredientId: item.ingredientId, lotId: lot.id, locationId,
        qty, unitId: item.unitId, refType: "PO", refId: po.id, note: note || `รับตาม ${po.code}`,
        userId: s.userId,
      },
    });
    await db.purchaseOrderItem.update({
      where: { id: item.id },
      data: { receivedQty: Number(item.receivedQty) + qty },
    });
    receivedAny = true;
  }
  if (!receivedAny) throw new Error("ไม่ได้ระบุจำนวนรับ");

  const updated = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
  const complete = updated.items.every((i) => Number(i.receivedQty) >= Number(i.orderQty));
  await db.purchaseOrder.update({ where: { id: poId }, data: { status: complete ? "RECEIVED" : "PARTIAL" } });
  if (!complete) {
    // แจ้งจัดซื้อ: ส่งไม่ครบ
    const procUsers = await db.user.findMany({ where: { role: { in: ["PROCUREMENT", "MANAGER"] }, active: true } });
    await db.notification.createMany({
      data: procUsers.map((u) => ({
        userId: u.id, type: "PO_INCOMPLETE", title: `${po.code} ส่งไม่ครบ`,
        message: "มีรายการค้างรับ ตรวจสอบ Outstanding ในใบสั่งซื้อ", link: `/purchase/${poId}`,
      })),
    });
  }
  await audit({ userId: s.userId, entity: "PurchaseOrder", entityId: poId, action: "UPDATE", detail: `รับของ ${po.code} (${complete ? "ครบ" : "ไม่ครบ"})` });
  revalidatePath(`/purchase/${poId}`);
  revalidatePath("/purchase");
  revalidatePath("/stock");
  redirect(`/purchase/${poId}`);
}
