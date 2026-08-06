import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="text-4xl mb-3">🔍</div>
        <h1 className="text-lg font-bold mb-2">ไม่พบหน้าที่ต้องการ</h1>
        <p className="text-sm text-gray-500 mb-5">หน้านี้อาจถูกลบ ย้าย หรือคุณไม่มีสิทธิ์เข้าถึง</p>
        <Link href="/" className="btn inline-block rounded-lg bg-[#1e3a5f] text-white px-5 py-2.5 text-sm font-semibold">
          กลับหน้าหลัก
        </Link>
      </div>
    </div>
  );
}
