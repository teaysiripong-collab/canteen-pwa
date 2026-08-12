"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, Input, NumberInput, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { FormAlert } from "@/components/ui/states";
import { saveSupplierItemAction } from "./actions";

export type SupplierItemFormValues = {
  id?: string;
  itemId?: string;
  supplierItemCode?: string | null;
  supplierItemName?: string | null;
  purchaseUnitId?: string | null;
  purchaseConversion?: string | null;
  moq?: string | null;
  packSize?: string | null;
  leadTimeDays?: number | null;
  lastPrice?: string | null;
  isPreferred?: boolean;
  isActive?: boolean;
};

export type SupplierItemOptions = {
  items: { id: string; code: string; nameTh: string; baseUnitCode: string | null }[];
  units: { id: string; code: string; nameTh: string }[];
};

export function SupplierItemForm({
  supplierId,
  options,
  values = {},
}: {
  supplierId: string;
  options: SupplierItemOptions;
  values?: SupplierItemFormValues;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveSupplierItemAction, undefined);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push(`/suppliers/${supplierId}`);
  }, [state, router, supplierId]);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
          <input type="hidden" name="supplierId" value={supplierId} />

          <Field label="วัตถุดิบ" htmlFor="itemId" required errors={errors?.itemId}>
            {values.id ? (
              // The pair (supplier, item) is the identity of the mapping, so it is fixed on edit.
              <>
                <input type="hidden" name="itemId" value={values.itemId} />
                <Input
                  readOnly
                  value={
                    options.items.find((item) => item.id === values.itemId)?.nameTh ?? "ไม่พบวัตถุดิบ"
                  }
                />
              </>
            ) : (
              <SearchSelect
                id="itemId"
                name="itemId"
                defaultValue={values.itemId ?? ""}
                placeholder="เลือกวัตถุดิบ"
                options={options.items.map((item) => ({
                  value: item.id,
                  label: item.nameTh,
                  hint: `${item.code}${item.baseUnitCode ? ` · ${item.baseUnitCode}` : ""}`,
                }))}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="รหัสสินค้าของผู้ขาย"
              htmlFor="supplierItemCode"
              errors={errors?.supplierItemCode}
            >
              <Input
                id="supplierItemCode"
                name="supplierItemCode"
                defaultValue={values.supplierItemCode ?? ""}
              />
            </Field>

            <Field
              label="ชื่อสินค้าของผู้ขาย"
              htmlFor="supplierItemName"
              errors={errors?.supplierItemName}
            >
              <Input
                id="supplierItemName"
                name="supplierItemName"
                defaultValue={values.supplierItemName ?? ""}
              />
            </Field>

            <Field
              label="หน่วยสั่งซื้อ"
              htmlFor="purchaseUnitId"
              errors={errors?.purchaseUnitId}
              hint="เว้นว่างเพื่อใช้หน่วยซื้อของวัตถุดิบ"
            >
              <Select
                id="purchaseUnitId"
                name="purchaseUnitId"
                defaultValue={values.purchaseUnitId ?? ""}
              >
                <option value="">ใช้ค่าจากวัตถุดิบ</option>
                {options.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.nameTh}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="ตัวคูณเป็นหน่วยหลัก"
              htmlFor="purchaseConversion"
              errors={errors?.purchaseConversion}
              hint="1 หน่วยสั่งซื้อ = กี่หน่วยหลัก เช่น 1 ลัง = 12 ขวด"
            >
              <NumberInput
                id="purchaseConversion"
                name="purchaseConversion"
                min={0}
                defaultValue={values.purchaseConversion ?? ""}
              />
            </Field>

            <Field
              label="สั่งขั้นต่ำ (MOQ)"
              htmlFor="moq"
              errors={errors?.moq}
              hint="จำนวนขั้นต่ำต่อ 1 ใบสั่งซื้อ"
            >
              <NumberInput id="moq" name="moq" min={0} defaultValue={values.moq ?? "0"} />
            </Field>

            <Field
              label="ขนาดแพ็ก"
              htmlFor="packSize"
              errors={errors?.packSize}
              hint="ระบบจะปัดจำนวนสั่งขึ้นเป็นจำนวนเท่าของค่านี้"
            >
              <NumberInput id="packSize" name="packSize" min={0} defaultValue={values.packSize ?? ""} />
            </Field>

            <Field
              label="Lead Time (วัน)"
              htmlFor="leadTimeDays"
              errors={errors?.leadTimeDays}
              hint="เว้นว่างเพื่อใช้ค่าของผู้ขาย"
            >
              <NumberInput
                id="leadTimeDays"
                name="leadTimeDays"
                min={0}
                defaultValue={values.leadTimeDays ?? ""}
              />
            </Field>

            <Field
              label="ราคาล่าสุด (บาท)"
              htmlFor="lastPrice"
              errors={errors?.lastPrice}
              hint="ต่อ 1 หน่วยสั่งซื้อ"
            >
              <NumberInput
                id="lastPrice"
                name="lastPrice"
                min={0}
                defaultValue={values.lastPrice ?? ""}
              />
            </Field>
          </div>

          <Checkbox
            name="isPreferred"
            label="เป็นผู้ขายหลักของวัตถุดิบนี้"
            defaultChecked={values.isPreferred ?? false}
          />
          <Checkbox name="isActive" label="เปิดใช้งาน" defaultChecked={values.isActive ?? true} />
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={pending}>
            บันทึก
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
