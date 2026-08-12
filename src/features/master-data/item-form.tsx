"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { FormAlert } from "@/components/ui/states";
import { saveItemAction } from "./actions";

export type ItemFormOptions = {
  units: Array<{ id: string; code: string; nameTh: string }>;
  categories: Array<{ id: string; nameTh: string }>;
  suppliers: Array<{ id: string; code: string; nameTh: string }>;
  locations: Array<{ id: string; code: string; nameTh: string }>;
};

export type ItemFormValues = {
  id?: string;
  code?: string;
  nameTh?: string;
  nameEn?: string | null;
  categoryId?: string | null;
  baseUnitId?: string;
  purchaseUnitId?: string;
  purchaseConversion?: string;
  preferredSupplierId?: string | null;
  defaultLocationId?: string | null;
  minimumStock?: string;
  reorderPoint?: string;
  safetyStock?: string;
  shelfLifeDays?: number | null;
  barcode?: string | null;
  isActive?: boolean;
  note?: string | null;
  aliases?: string[];
};

export function ItemForm({
  options,
  values = {},
}: {
  options: ItemFormOptions;
  values?: ItemFormValues;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveItemAction, undefined);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push("/items");
  }, [state, router]);

  const unitOptions = options.units.map((unit) => ({
    value: unit.id,
    label: `${unit.nameTh} (${unit.code})`,
  }));

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="รหัสวัตถุดิบ" htmlFor="code" required errors={errors?.code}>
              <Input id="code" name="code" defaultValue={values.code} required autoCapitalize="characters" />
            </Field>

            <Field label="ชื่อวัตถุดิบ (ไทย)" htmlFor="nameTh" required errors={errors?.nameTh}>
              <Input id="nameTh" name="nameTh" defaultValue={values.nameTh} required />
            </Field>

            <Field label="ชื่อวัตถุดิบ (อังกฤษ)" htmlFor="nameEn" errors={errors?.nameEn}>
              <Input id="nameEn" name="nameEn" defaultValue={values.nameEn ?? ""} />
            </Field>

            <Field label="หมวดหมู่" htmlFor="categoryId" errors={errors?.categoryId}>
              <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
                <option value="">ไม่ระบุ</option>
                {options.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameTh}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-ink">หน่วยนับ</legend>

            <Field label="หน่วยหลัก (เก็บสต๊อก)" htmlFor="baseUnitId" required errors={errors?.baseUnitId}>
              <Select id="baseUnitId" name="baseUnitId" defaultValue={values.baseUnitId ?? ""} required>
                <option value="" disabled>
                  เลือกหน่วย
                </option>
                {unitOptions.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="หน่วยสั่งซื้อ" htmlFor="purchaseUnitId" required errors={errors?.purchaseUnitId}>
              <Select
                id="purchaseUnitId"
                name="purchaseUnitId"
                defaultValue={values.purchaseUnitId ?? ""}
                required
              >
                <option value="" disabled>
                  เลือกหน่วย
                </option>
                {unitOptions.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="ตัวคูณเป็นหน่วยหลัก"
              htmlFor="purchaseConversion"
              required
              errors={errors?.purchaseConversion}
              hint="1 หน่วยสั่งซื้อ = กี่หน่วยหลัก"
            >
              <NumberInput
                id="purchaseConversion"
                name="purchaseConversion"
                min={0}
                defaultValue={values.purchaseConversion ?? "1"}
                required
              />
            </Field>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ผู้ขายหลัก" htmlFor="preferredSupplierId" errors={errors?.preferredSupplierId}>
              <SearchSelect
                id="preferredSupplierId"
                name="preferredSupplierId"
                defaultValue={values.preferredSupplierId ?? ""}
                placeholder="ไม่ระบุ"
                options={options.suppliers.map((supplier) => ({
                  value: supplier.id,
                  label: supplier.nameTh,
                  hint: supplier.code,
                }))}
              />
            </Field>

            <Field
              label="สถานที่จัดเก็บแนะนำ"
              htmlFor="defaultLocationId"
              errors={errors?.defaultLocationId}
            >
              <Select id="defaultLocationId" name="defaultLocationId" defaultValue={values.defaultLocationId ?? ""}>
                <option value="">ไม่ระบุ</option>
                {options.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.nameTh} ({location.code})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="สต๊อกขั้นต่ำ" htmlFor="minimumStock" errors={errors?.minimumStock}>
              <NumberInput id="minimumStock" name="minimumStock" min={0} defaultValue={values.minimumStock ?? "0"} />
            </Field>

            <Field
              label="จุดสั่งซื้อ (Reorder Point)"
              htmlFor="reorderPoint"
              errors={errors?.reorderPoint}
              hint="ต่ำกว่าจำนวนนี้ ระบบจะแจ้งเตือนให้สั่งซื้อ"
            >
              <NumberInput id="reorderPoint" name="reorderPoint" min={0} defaultValue={values.reorderPoint ?? "0"} />
            </Field>

            <Field
              label="สต๊อกสำรอง (Safety Stock)"
              htmlFor="safetyStock"
              errors={errors?.safetyStock}
              hint="กันไว้เผื่อฉุกเฉิน ระบบจะบวกเพิ่มตอนคำนวณจำนวนสั่งซื้อ"
            >
              <NumberInput id="safetyStock" name="safetyStock" min={0} defaultValue={values.safetyStock ?? "0"} />
            </Field>

            <Field
              label="อายุการเก็บ (วัน)"
              htmlFor="shelfLifeDays"
              errors={errors?.shelfLifeDays}
              hint="เว้นว่างได้ถ้าไม่กำหนด"
            >
              <NumberInput
                id="shelfLifeDays"
                name="shelfLifeDays"
                min={0}
                defaultValue={values.shelfLifeDays ?? ""}
              />
            </Field>

            <Field label="บาร์โค้ด" htmlFor="barcode" errors={errors?.barcode} hint="เตรียมไว้สำหรับสแกนในอนาคต">
              <Input id="barcode" name="barcode" defaultValue={values.barcode ?? ""} />
            </Field>
          </div>

          <Field
            label="ชื่อเรียกอื่น (Alias)"
            htmlFor="aliases"
            errors={errors?.aliases}
            hint="คั่นด้วยเครื่องหมายจุลภาค เช่น ไก่สับ, ไก่บดละเอียด — ใช้ช่วยค้นหาหน้างาน"
          >
            <Input id="aliases" name="aliases" defaultValue={(values.aliases ?? []).join(", ")} />
          </Field>

          <Field label="หมายเหตุ" htmlFor="note" errors={errors?.note}>
            <Textarea id="note" name="note" defaultValue={values.note ?? ""} />
          </Field>

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
