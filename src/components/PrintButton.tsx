"use client";

export default function PrintButton({ label = "🖨️ พิมพ์" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="btn inline-flex items-center justify-center rounded-lg bg-[#1e3a5f] text-white px-4 py-2 text-sm font-semibold hover:bg-[#2d5580]"
    >
      {label}
    </button>
  );
}
