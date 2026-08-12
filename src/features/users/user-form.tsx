"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, FieldError, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { saveUserAction } from "./actions";

export type UserFormValues = {
  id?: string;
  email?: string;
  fullName?: string;
  phone?: string | null;
  defaultLocationId?: string | null;
  roleCodes?: string[];
  isActive?: boolean;
};

export type RoleOption = { code: string; nameTh: string };
export type LocationOption = { id: string; code: string; nameTh: string };

export function UserForm({
  values = {},
  roles,
  locations,
}: {
  values?: UserFormValues;
  roles: RoleOption[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveUserAction, undefined);
  const errors = state?.ok === false ? state.fieldErrors : undefined;
  const assigned = values.roleCodes ?? [];

  useEffect(() => {
    if (state?.ok) router.push("/users");
  }, [state, router]);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="อีเมล"
              htmlFor="email"
              required
              errors={errors?.email}
              hint="ใช้อีเมลนี้เข้าสู่ระบบ"
            >
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                defaultValue={values.email}
                required
              />
            </Field>

            <Field label="ชื่อ-นามสกุล" htmlFor="fullName" required errors={errors?.fullName}>
              <Input id="fullName" name="fullName" defaultValue={values.fullName} required />
            </Field>

            <Field label="เบอร์โทร" htmlFor="phone" errors={errors?.phone}>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={values.phone ?? ""}
              />
            </Field>

            <Field
              label="สถานที่ประจำ"
              htmlFor="defaultLocationId"
              errors={errors?.defaultLocationId}
              hint="ใช้เป็นค่าตั้งต้นตอนรับ/เบิกของ"
            >
              <Select
                id="defaultLocationId"
                name="defaultLocationId"
                defaultValue={values.defaultLocationId ?? ""}
              >
                <option value="">ไม่ระบุ</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.nameTh}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="text-sm font-medium text-ink">
              บทบาท<span className="ml-0.5 text-critical">*</span>
            </legend>
            <p className="text-xs text-ink-muted">
              สิทธิ์ทั้งหมดมาจากบทบาท และถูกตรวจสอบที่เซิร์ฟเวอร์ทุกครั้ง
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <Checkbox
                  key={role.code}
                  name="roleCodes"
                  value={role.code}
                  label={`${role.nameTh} (${role.code})`}
                  defaultChecked={assigned.includes(role.code)}
                />
              ))}
            </div>
            <FieldError messages={errors?.roleCodes} />
          </fieldset>

          <Checkbox name="isActive" label="เปิดใช้งานบัญชี" defaultChecked={values.isActive ?? true} />
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
