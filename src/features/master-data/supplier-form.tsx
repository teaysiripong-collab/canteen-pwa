"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, Input, NumberInput, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { saveSupplierAction } from "./actions";

export type SupplierFormValues = {
  id?: string;
  code?: string;
  nameTh?: string;
  nameEn?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  leadTimeDays?: number;
  paymentTerm?: string | null;
  remark?: string | null;
  isActive?: boolean;
};

export function SupplierForm({ values = {} }: { values?: SupplierFormValues }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveSupplierAction, undefined);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push("/suppliers");
  }, [state, router]);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="รหัสผู้ขาย" htmlFor="code" required errors={errors?.code}>
              <Input id="code" name="code" defaultValue={values.code} required autoCapitalize="characters" />
            </Field>

            <Field label="ชื่อผู้ขาย (ไทย)" htmlFor="nameTh" required errors={errors?.nameTh}>
              <Input id="nameTh" name="nameTh" defaultValue={values.nameTh} required />
            </Field>

            <Field label="ชื่อผู้ขาย (อังกฤษ)" htmlFor="nameEn" errors={errors?.nameEn}>
              <Input id="nameEn" name="nameEn" defaultValue={values.nameEn ?? ""} />
            </Field>

            <Field label="ผู้ติดต่อ" htmlFor="contactName" errors={errors?.contactName}>
              <Input id="contactName" name="contactName" defaultValue={values.contactName ?? ""} />
            </Field>

            <Field label="เบอร์โทร" htmlFor="phone" errors={errors?.phone}>
              <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={values.phone ?? ""} />
            </Field>

            <Field label="อีเมล" htmlFor="email" errors={errors?.email}>
              <Input id="email" name="email" type="email" inputMode="email" defaultValue={values.email ?? ""} />
            </Field>

            <Field
              label="Lead Time (วัน)"
              htmlFor="leadTimeDays"
              errors={errors?.leadTimeDays}
              hint="ระยะเวลาจากสั่งซื้อจนของถึง"
            >
              <NumberInput id="leadTimeDays" name="leadTimeDays" min={0} defaultValue={values.leadTimeDays ?? 1} />
            </Field>

            <Field label="เงื่อนไขการชำระเงิน" htmlFor="paymentTerm" errors={errors?.paymentTerm}>
              <Input id="paymentTerm" name="paymentTerm" defaultValue={values.paymentTerm ?? ""} placeholder="เช่น เครดิต 30 วัน" />
            </Field>
          </div>

          <Field label="ที่อยู่" htmlFor="address" errors={errors?.address}>
            <Textarea id="address" name="address" defaultValue={values.address ?? ""} />
          </Field>

          <Field label="หมายเหตุ" htmlFor="remark" errors={errors?.remark}>
            <Textarea id="remark" name="remark" defaultValue={values.remark ?? ""} />
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
