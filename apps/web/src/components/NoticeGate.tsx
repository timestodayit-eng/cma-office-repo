"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readNoticeAction } from "@/app/noticeActions";
import type { UnreadNotice } from "@/lib/notices";

/**
 * Shows every unread notice over the whole screen, one at a time. It cannot be closed:
 * the only way on is to tick "Yes, I have read it". While nothing is open it asks the server
 * every 20 seconds, so a notice sent just now pops up by itself.
 */
export function NoticeGate({ notices }: { notices: UnreadNotice[] }) {
  const router = useRouter();
  const [ticked, setTicked] = useState(false);
  const [busy, start] = useTransition();
  const n = notices[0];

  useEffect(() => {
    if (n) return;
    const ask = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/notices", { cache: "no-store" });
        if (r.ok && (await r.json()).unread > 0) router.refresh();
      } catch {}
    };
    const t = setInterval(ask, 20000);
    document.addEventListener("visibilitychange", ask);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", ask); };
  }, [n, router]);

  useEffect(() => { setTicked(false); }, [n?.id]);
  useEffect(() => {
    if (!n) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [n]);

  if (!n) return null;
  return (
    <div className="notice-wall" role="alertdialog" aria-modal="true" aria-labelledby="notice-h">
      <div className="notice-box">
        <div className="notice-top">
          <span className="pill p-pri">Notice{notices.length > 1 ? ` · 1 of ${notices.length}` : ""}</span>
          <span className="small muted">{n.from} · {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }).format(new Date(n.at))}</span>
        </div>
        <h2 id="notice-h">{n.title}</h2>
        <div className="notice-body">{n.body}</div>
        <label className="notice-tick">
          <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span>Yes, I have read this notice</span>
        </label>
        <button className="btn primary" disabled={!ticked || busy} onClick={() => start(async () => { await readNoticeAction(n.id); router.refresh(); })}>
          {busy ? "Saving…" : "Done"}
        </button>
      </div>
    </div>
  );
}
