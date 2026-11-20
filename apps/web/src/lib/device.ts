// Device tracking: each installed desktop app reports itself (device id, machine
// name, logged-in user) and the server records when it was last online and the
// approximate area looked up from its public IP. Transparent IT asset tracking,
// to help find a lost or stolen company laptop. Only Work Monitor admins see it.
import "server-only";
import { prisma } from "./db";

/** Read the caller's public IP from the request. Works both in direct mode
 *  (Next.js sees the socket address) and behind a reverse proxy (Caddy sets
 *  x-forwarded-for). The left-most forwarded address is the real client. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return stripPort(first);
  }
  const real = req.headers.get("x-real-ip");
  if (real) return stripPort(real.trim());
  return null;
}

function stripPort(ip: string): string {
  // IPv6 in brackets, or IPv4:port
  if (ip.startsWith("[")) return ip.slice(1, ip.indexOf("]"));
  const c = ip.split(":");
  return c.length === 2 && /^\d+$/.test(c[1]) ? c[0] : ip;
}

/** Private, loopback or link-local addresses never have a public location. */
export function isPrivateIp(ip: string | null): boolean {
  if (!ip) return true;
  if (ip === "::1" || ip.startsWith("::ffff:127.") || ip.startsWith("127.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true; // ULA / link-local
  return false;
}

export type Geo = { city?: string; region?: string; country?: string; lat?: number; lng?: number };

/** Look up a public IP's approximate area. Uses the free ip-api.com service (no
 *  key, city-level, best effort). Returns null on any problem; tracking of the
 *  device itself still works, only the area is left blank. */
export async function lookupGeo(ip: string): Promise<Geo | null> {
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const j = (await r.json()) as { status?: string; country?: string; regionName?: string; city?: string; lat?: number; lon?: number };
    if (j.status !== "success") return null;
    return {
      city: j.city || undefined,
      region: j.regionName || undefined,
      country: j.country || undefined,
      lat: typeof j.lat === "number" ? j.lat : undefined,
      lng: typeof j.lon === "number" ? j.lon : undefined,
    };
  } catch {
    return null;
  }
}

/** Re-look-up the area only when the IP changed or the last lookup is this old. */
const GEO_TTL = 6 * 60 * 60_000;

/** Record a device report: upsert the device row and, when the public IP is new
 *  or the saved area is stale, refresh its area from the IP. */
export async function recordDevice(input: {
  deviceId: string;
  userId: string;
  machineName?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  ip: string | null;
}) {
  const now = new Date();
  const existing = await prisma.device.findUnique({ where: { deviceId: input.deviceId } });

  let geo: Geo | null = null;
  let geoAt: Date | undefined;
  const ipPublic = input.ip && !isPrivateIp(input.ip) ? input.ip : null;
  if (ipPublic) {
    const ipChanged = existing?.publicIp !== ipPublic;
    const stale = !existing?.geoAt || now.getTime() - existing.geoAt.getTime() > GEO_TTL;
    if (ipChanged || stale) {
      geo = await lookupGeo(ipPublic);
      if (geo) geoAt = now;
    }
  }

  const common = {
    machineName: input.machineName ?? undefined,
    platform: input.platform ?? undefined,
    osVersion: input.osVersion ?? undefined,
    appVersion: input.appVersion ?? undefined,
    userId: input.userId,
    lastSeenAt: now,
    ...(ipPublic ? { publicIp: ipPublic } : {}),
    ...(geo ? { city: geo.city ?? null, region: geo.region ?? null, country: geo.country ?? null, lat: geo.lat ?? null, lng: geo.lng ?? null, geoAt } : {}),
  };

  await prisma.device.upsert({
    where: { deviceId: input.deviceId },
    update: common,
    create: { deviceId: input.deviceId, ...common },
  });
}
