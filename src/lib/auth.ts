import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Role } from "@prisma/client";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");
const COOKIE = "canteen_session";

export type Session = {
  userId: string;
  username: string;
  name: string;
  role: Role;
};

export async function createSession(s: Session) {
  const token = await new SignJWT(s)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as Session;
  } catch {
    return null;
  }
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}
