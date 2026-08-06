import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, getSession } from "@/lib/auth";

export const metadata = { title: "เข้าสู่ระบบ" };

async function login(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    redirect("/login?error=1");
  }
  await createSession({ userId: user.id, username: user.username, name: user.name, role: user.role });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  if (session) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#1e3a5f] to-[#2d5580] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🍳</div>
          <h1 className="text-xl font-bold text-[#1e3a5f]">Canteen Management System</h1>
          <p className="text-sm text-gray-500 mt-1">ระบบบริหารงานแคนทีน</p>
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            🔴 ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง
          </div>
        )}
        <form action={login} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="username">ชื่อผู้ใช้</label>
            <input id="username" name="username" required autoFocus autoComplete="username"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="password">รหัสผ่าน</label>
            <input id="password" name="password" type="password" required autoComplete="current-password"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
          </div>
          <button type="submit"
            className="w-full rounded-lg bg-[#1e3a5f] text-white font-semibold py-3 hover:bg-[#2d5580] transition-colors">
            เข้าสู่ระบบ
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-6 text-center">
          ทดลองใช้: admin / manager / supervisor / procurement / store / staff1 — รหัสผ่าน 1234
        </p>
      </div>
    </main>
  );
}
