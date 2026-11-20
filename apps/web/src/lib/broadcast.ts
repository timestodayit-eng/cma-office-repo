// Call broadcast days grouped the way the officer works: one card per company, call
// date and slot. Two interviews 1-3 days apart (a bridge) share the same call days.
import type { BroadcastSlot, Company, Interview } from "@prisma/client";
import { prisma } from "./db";
import { todayDhaka } from "./format";

export type BcSlot = BroadcastSlot & { interview: Interview & { company: Company } };
export type BcGroup = {
  key: string; company: Company; date: Date; due: Date; slot: string; slots: BcSlot[];
  missed: boolean; received: boolean; sms: boolean; done: boolean;
};

const DAY = 86_400_000;

export function groupSlots(slots: BcSlot[]): BcGroup[] {
  const map = new Map<string, BcGroup>();
  for (const b of slots) {
    const key = `${b.interview.companyId}|${b.callDate.toISOString().slice(0, 10)}|${b.slot}`;
    let g = map.get(key);
    if (!g) {
      g = { key, company: b.interview.company, date: b.callDate, due: new Date(b.callDate.getTime() - DAY), slot: b.slot, slots: [], missed: true, received: true, sms: true, done: false };
      map.set(key, g);
    }
    g.slots.push(b);
  }
  for (const g of map.values()) {
    g.missed = g.slots.every((s) => s.missedSent);
    g.received = g.slots.every((s) => s.receivedSent);
    g.sms = g.slots.every((s) => s.smsSent);
    g.done = g.missed && g.received;
  }
  return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime() || a.company.sortOrder - b.company.sortOrder || a.slot.localeCompare(b.slot));
}

export async function bcGroups(from: Date, to: Date) {
  const slots = await prisma.broadcastSlot.findMany({
    where: { callDate: { gte: from, lte: to } },
    include: { interview: { include: { company: true } } },
  });
  return groupSlots(slots);
}

/** To send now: the call is today, or it is tomorrow (the request goes the day before). */
export async function bcOpen(today = todayDhaka()) {
  return (await bcGroups(today, new Date(today.getTime() + DAY))).filter((g) => !g.done);
}

export async function officerOf(companyIds: string[]) {
  const roles = await prisma.companyRole.findMany({ where: { role: "broadcast_officer", companyId: { in: companyIds } }, include: { user: true } });
  return new Map(roles.map((r) => [r.companyId!, r.user]));
}

export async function myBroadcast(userId: string) {
  const mine = await prisma.companyRole.findMany({ where: { userId, role: "broadcast_officer" }, select: { companyId: true } });
  if (!mine.length) return [];
  const ids = new Set(mine.map((m) => m.companyId));
  return (await bcOpen()).filter((g) => ids.has(g.company.id));
}
export const myBroadcastCount = async (userId: string) => (await myBroadcast(userId)).length;
