export const metadata = { title: "ออฟไลน์" };

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 text-center">
      <div>
        <div className="text-5xl mb-4">📡</div>
        <h1 className="text-xl font-bold mb-2">ไม่สามารถเชื่อมต่ออินเทอร์เน็ต</h1>
        <p className="text-gray-500 mb-6">ข้อมูลที่กรอกค้างไว้ยังอยู่ในหน้าจอ — เมื่อสัญญาณกลับมาให้กดบันทึกอีกครั้ง</p>
        <a href="/" className="btn inline-block rounded-lg bg-[#1e3a5f] text-white px-6 py-3 font-semibold">ลองใหม่</a>
      </div>
    </main>
  );
}
