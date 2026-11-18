import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { prisma } from "./db";
import { canAccess, type Access, type Level, type ModuleKey } from "@cma/core";

const COOKIE = "cma_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function verifyPassword(phone: string, password: string) {
  const user = await prisma.user.findUnique({ where: { phone: normalizePhone(phone) } });
  if (!user || !user.active) return null;
  return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
}

export function normalizePhone(p: string) {
  const digits = p.replace(/\D/g, "");
  return digits.startsWith("880") ? "0" + digits.slice(3) : digits;
}

export type CurrentUser = Awaited<ReturnType<typeof loadUser>>;

async function loadUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { permissions: true, responsibilities: true },
  });
  if (!user || !user.active) return null;
  const perms = Object.fromEntries(user.permissions.map((p) => [p.module, p.access])) as Record<string, Access>;
  const resp = new Set(user.responsibilities.map((r) => r.key));
  return {
    ...user,
    perms,
    resp,
    can: (m: ModuleKey, need: "VIEW" | "EDIT" = "VIEW") => canAccess(user.level as Level, perms, m, need),
    has: (r: string) => user.level === "SUPER_ADMIN" || resp.has(r),
  };
}

export const getUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.sub ? await loadUser(payload.sub) : null;
  } catch {
    return null;
  }
});

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireModule(m: ModuleKey, need: "VIEW" | "EDIT" = "VIEW") {
  const u = await requireUser();
  if (!u.can(m, need)) redirect("/?denied=" + m);
  return u;
}
