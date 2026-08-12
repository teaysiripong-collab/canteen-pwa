"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { LOCATION_KIND_LABELS_TH, locationKinds } from "@/schemas/master-data";
import { saveLocationAction } from "./actions";

export type LocationFormValues = {
  id?: string;
  code?: string;
  nameTh?: string;
  nameEn?: string | null;
  kind?: (typeof locationKinds)[number];
  holdsStock?: boolean;
  isActive?: boolean;
  note?: string | null;
};

export function LocationForm({ values = {} }: { values?: LocationFormValues }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveLocationAction, undefined);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push("/locations");
  }, [state, router]);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="รหัสสถานที่" htmlFor="code" required errors={errors?.code} hint="เช่น B1, B16">
              <Input id="code" name="code" defaultValue={values.code} required autoCapitalize="characters" />
            </Field>

            <Field label="ชื่อสถานที่ (ไทย)" htmlFor="nameTh" required errors={errors?.nameTh}>
              <Input id="nameTh" name="nameTh" defaultValue={values.nameTh} required />
            </Field>

            <Field label="ชื่อสถานที่ (อังกฤษ)" htmlFor="nameEn" errors={errors?.nameEn}>
              <Input id="nameEn" name="nameEn" defaultValue={values.nameEn ?? ""} />
            </Field>

            <Field label="ประเภท" htmlFor="kind" errors={errors?.kind}>
              <Select id="kind" name="kind" defaultValue={values.kind ?? "STORE"}>
                {locationKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {LOCATION_KIND_LABELS_TH[kind]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="หมายเหตุ" htmlFor="note" errors={errors?.note}>
            <Textarea id="note" name="note" defaultValue={values.note ?? ""} />
          </Field>

          <div className="flex flex-col gap-3">
            <Checkbox
              name="holdsStock"
              label="สถานที่นี้เก็บสต๊อก (นับยอดคงเหลือและโอนได้)"
              defaultChecked={values.holdsStock ?? true}
            />
            <Checkbox name="isActive" label="เปิดใช้งาน" defaultChecked={values.isActive ?? true} />
          </div>
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
