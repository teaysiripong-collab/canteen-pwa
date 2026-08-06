import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "/";
  const origin = req.nextUrl.origin;
  const url = origin + path;
  const png = await QRCode.toBuffer(url, { width: 280, margin: 1 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
}
