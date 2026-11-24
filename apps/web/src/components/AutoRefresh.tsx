"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page every few seconds while `active`, so "Connected" shows up by itself. */
export function AutoRefresh({ active, every = 5000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
