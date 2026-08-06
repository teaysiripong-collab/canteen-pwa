"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message.includes("FORBIDDEN");
  const unauthorized = error.message.includes("UNAUTHORIZED");

  const title = forbidden ? "คุณไม่มีสิทธิ์ทำรายการนี้"
    : unauthorized ? "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
    : "ทำรายการไม่สำเร็จ";

  // Validation messages thrown by server actions are meant to be read by the user.
  const detail = forbidden || unauthorized ? null : error.message;

  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="bg-white rounded-xl border border-red-300 shadow-sm p-6 text-center">
        <div className="text-4xl mb-3">{forbidden ? "🔒" : "🔴"}</div>
        <h1 className="text-lg font-bold text-red-800 mb-2">{title}</h1>
        {detail && <p className="text-sm text-gray-700 mb-4 whitespace-pre-wrap">{detail}</p>}
        <div className="flex flex-wrap gap-2 justify-center mt-4">
          <button onClick={reset}
            className="btn rounded-lg bg-[#1e3a5f] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[#2d5580]">
            ลองอีกครั้ง
          </button>
          {unauthorized ? (
            <a href="/login" className="btn rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700">
              เข้าสู่ระบบ
            </a>
          ) : (
            <Link href="/" className="btn rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700">
              กลับหน้าหลัก
            </Link>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-4">ข้อมูลที่กรอกไว้ยังไม่ถูกบันทึก — กรุณาตรวจสอบแล้วทำรายการใหม่</p>
      </div>
    </div>
  );
}
