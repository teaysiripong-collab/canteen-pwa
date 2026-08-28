"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { saveMenuAction } from "./actions";

export type MenuFormValues = {
  id?: string;
  code?: string;
  nameTh?: string;
  nameEn?: string | null;
  categoryId?: string | null;
  isActive?: boolean;
  note?: string | null;
};

export function MenuForm({
  values = {},
  categories,
}: {
  values?: MenuFormValues;
  categories: Array<{ id: string; nameTh: string }>;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveMenuAction, undefined);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push("/menu/master");
  }, [state, router]);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="รหัสเมนู" htmlFor="code" required errors={errors?.code}>
              <Input id="code" name="code" defaultValue={values.code} required autoCapitalize="characters" />
            </Field>

            <Field label="ชื่อเมนู (ไทย)" htmlFor="nameTh" required errors={errors?.nameTh}>
              <Input id="nameTh" name="nameTh" defaultValue={values.nameTh} required />
            </Field>

            <Field label="ชื่อเมนู (อังกฤษ)" htmlFor="nameEn" errors={errors?.nameEn}>
              <Input id="nameEn" name="nameEn" defaultValue={values.nameEn ?? ""} />
            </Field>

            <Field label="หมวดหมู่" htmlFor="categoryId" errors={errors?.categoryId}>
              <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
                <option value="">ไม่ระบุ</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameTh}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

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
