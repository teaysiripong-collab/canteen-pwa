import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canteen ERP",
  description: "ระบบบริหารโรงอาหาร: เมนู BOM สต๊อก จัดซื้อ ต้นทุน และรายงาน",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f5c4b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
