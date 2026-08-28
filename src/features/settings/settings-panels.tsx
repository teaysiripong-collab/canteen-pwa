"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import type { SettingsSnapshot } from "@/services/settings-service";
import {
  saveDocumentPrefixesAction,
  saveExpiryThresholdsAction,
  saveNegativeStockAction,
} from "./actions";

const PREFIX_LABELS: Record<string, string> = {
  goodsReceipt: "ใบรับสินค้า",
  stockIssue: "ใบเบิก",
  stockTransfer: "ใบโอน",
  purchaseOrder: "ใบสั่งซื้อ",
  stockCount: "ใบตรวจนับ",
};

function useSaver() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setNotice("บันทึกแล้ว");
      router.refresh();
    });
  };

  return { error, notice, pending, run };
}

/** Which day thresholds count as "expiring soon". Read by the alert centre and the expiry page. */
export function ExpiryThresholdPanel({ days }: { days: number[] }) {
  const [value, setValue] = useState(days.join(", "));
  const { error, notice, pending, run } = useSaver();

  const parsed = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part >= 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>เกณฑ์แจ้งเตือนของใกล้หมดอายุ</CardTitle>
        <CardDescription>
          ใส่จำนวนวันคั่นด้วยจุลภาค เช่น 1, 3, 7 — ค่าที่น้อยที่สุดคือเกณฑ์ &ldquo;เร่งด่วน&rdquo;
          ที่ใช้ในหน้าเรื่องที่ต้องดูแล
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        {error ? <FormAlert message={error} /> : null}
        {notice ? <FormAlert tone="success" message={notice} /> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expiry-days">จำนวนวัน</Label>
          <Input
            id="expiry-days"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="numeric"
          />
          <p className="text-xs text-ink-subtle">
            จะบันทึกเป็น: {parsed.length > 0 ? parsed.join(" / ") : "— ต้องมีอย่างน้อย 1 ค่า"}
          </p>
        </div>

        <div>
          <Button
            loading={pending}
            disabled={parsed.length === 0}
            onClick={() => run(() => saveExpiryThresholdsAction(parsed))}
          >
            บันทึก
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Document number prefixes. Changing one affects documents created from now on, not old ones. */
export function DocumentPrefixPanel({
  prefixes,
}: {
  prefixes: SettingsSnapshot["documentPrefixes"];
}) {
  const [value, setValue] = useState<Record<string, string>>({ ...prefixes });
  const { error, notice, pending, run } = useSaver();

  return (
    <Card>
      <CardHeader>
        <CardTitle>คำนำหน้าเลขที่เอกสาร</CardTitle>
        <CardDescription>
          เลขที่เอกสารคือ คำนำหน้า-YYYYMMDD-ลำดับ การเปลี่ยนมีผลกับเอกสารที่ออกใหม่เท่านั้น
          เอกสารเดิมยังใช้เลขเดิมตลอดไป
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        {error ? <FormAlert message={error} /> : null}
        {notice ? <FormAlert tone="success" message={notice} /> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(value).map(([key, prefix]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`prefix-${key}`}>{PREFIX_LABELS[key] ?? key}</Label>
              <Input
                id={`prefix-${key}`}
                value={prefix}
                maxLength={6}
                onChange={(event) =>
                  setValue((current) => ({
                    ...current,
                    [key]: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
          ))}
        </div>

        <div>
          <Button
            loading={pending}
            disabled={Object.values(value).some((prefix) => prefix.trim() === "")}
            onClick={() => run(() => saveDocumentPrefixesAction(value))}
          >
            บันทึก
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** The one setting that can let the ledger lie; it says so plainly rather than hiding it. */
export function NegativeStockPanel({ allowed }: { allowed: boolean }) {
  const [value, setValue] = useState(allowed);
  const { error, notice, pending, run } = useSaver();

  return (
    <Card>
      <CardHeader>
        <CardTitle>อนุญาตให้สต๊อกติดลบ</CardTitle>
        <CardDescription>
          ปกติระบบจะปฏิเสธการเบิกที่มากกว่ายอดคงเหลือ เปิดค่านี้เมื่อจำเป็นจริงๆ เท่านั้น —
          สต๊อกติดลบหมายความว่าตัวเลขในระบบไม่ตรงกับของบนชั้นอีกต่อไป
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        {error ? <FormAlert message={error} /> : null}
        {notice ? <FormAlert tone="success" message={notice} /> : null}

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={value}
            onChange={(event) => setValue(event.target.checked)}
            className="h-5 w-5 accent-[var(--color-brand)]"
          />
          <span className="text-sm text-ink">อนุญาตให้ยอดคงเหลือติดลบได้</span>
        </label>

        <div>
          <Button
            variant={value ? "danger" : "primary"}
            loading={pending}
            onClick={() => run(() => saveNegativeStockAction(value))}
          >
            บันทึก
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
