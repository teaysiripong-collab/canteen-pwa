"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { signInAction } from "../actions";

export function LoginForm({ devMode, configured }: { devMode: boolean; configured: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signInAction, undefined);

  useEffect(() => {
    if (state?.ok) router.replace("/dashboard");
  }, [state, router]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {!configured ? (
          <FormAlert message="ยังไม่ได้ตั้งค่าการเข้าสู่ระบบ กรุณาตั้งค่า Supabase Auth ในไฟล์ .env.local" />
        ) : null}

        {devMode ? (
          <div className="rounded-[var(--radius-control)] bg-info-soft px-3 py-2.5 text-sm text-info">
            โหมดพัฒนา: เข้าสู่ระบบด้วยอีเมลอย่างเดียว (ปิดอัตโนมัติบน production)
          </div>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          {state && !state.ok ? <FormAlert message={state.message} /> : null}

          <Field label="อีเมล" htmlFor="email" required errors={state?.ok === false ? state.fieldErrors?.email : undefined}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              placeholder="you@company.com"
            />
          </Field>

          {!devMode ? (
            <Field label="รหัสผ่าน" htmlFor="password" required>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
          ) : null}

          <Button type="submit" size="lg" block loading={pending}>
            เข้าสู่ระบบ
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
