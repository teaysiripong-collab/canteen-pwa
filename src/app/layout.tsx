import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Canteen Management System", template: "%s | Canteen MS" },
  description: "ระบบบริหารงานแคนทีน — วางแผนเมนู BOM จัดซื้อ Stock ต้นทุน และงานที่มอบหมาย",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Canteen MS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a5f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`,
          }}
        />
      </body>
    </html>
  );
}
