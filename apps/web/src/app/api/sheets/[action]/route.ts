// The door the Google Sheet scripts use. Every call carries the secret shown in Settings.
//   push: sheet -> app (whole tabs)      pull: app -> sheet (waiting changes)      ack: results
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { getSheetConfig, patchSheetConfig, pullOps, ackOps, type SheetKind } from "@/lib/outbox";
import { importRecruitment, importBroadcast, importLogDay, companyByName, type RecRow, type BlRow } from "@/lib/dataImport";
import { recFieldOf, findHeaderRow, parseSheetDate, logTabDate, truthy, type RecField } from "@/lib/sheetRules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KINDS = ["recruitment", "broadcast", "log"];
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function recRows(values: unknown[][]): RecRow[] {
  const h = findHeaderRow(values);
  if (h < 0) throw new Error('No "Interview Date" header found');
  const col: Partial<Record<RecField, number>> = {};
  (values[h] ?? []).forEach((c, i) => { const f = recFieldOf(c); if (f && col[f] == null) col[f] = i; });
  if (col.date == null || col.co == null) throw new Error("Company Name / Interview Date columns not found");
  const get = (r: unknown[], f: RecField) => (col[f] == null ? undefined : r[col[f]!]);
  const out: RecRow[] = [];
  for (const r of values.slice(h + 1)) {
    const date = parseSheetDate(get(r, "date"));
    const co = String(get(r, "co") ?? "").trim();
    if (!date || !co) continue;
    const t = (f: RecField) => String(get(r, f) ?? "").trim() || undefined;
    out.push({
      co, date, country: t("country") ?? "", work: t("work"), details: t("details"), status: t("status"), topup: t("topup"),
      mplan: get(r, "mplan") as number, pc: get(r, "pc") as number, usd: get(r, "usd") as number, bdt: get(r, "bdt") as number, leads: get(r, "leads") as number,
    });
  }
  return out;
}

/** Panel layout: A agency, B company, C country, D interview date, E day, then 7 x (date, Received, Missed), AA type. */
function blRows(values: unknown[][]): BlRow[] {
  const h = findHeaderRow(values);
  if (h < 0) throw new Error('No "Interview Date" header found');
  const head = (values[h] ?? []).map((c) => String(c ?? "").trim());
  const first = head.findIndex((c) => /^V1\b/i.test(c));
  if (first < 0) throw new Error("V1 column not found");
  const out: BlRow[] = [];
  for (const r of values.slice(h + 1)) {
    const date = parseSheetDate(r[3]);
    const co = String(r[1] ?? "").trim();
    if (!date || !co) continue;
    const ref = new Date(date);
    const v: BlRow["v"] = [];
    for (let i = 0; i < 7; i++) {
      const c = first + i * 3;
      v.push([parseSheetDate(r[c], ref), truthy(r[c + 1]), truthy(r[c + 2])]);
    }
    const type = String(r[first + 21] ?? "").trim().toUpperCase();
    out.push({ co, date, country: String(r[2] ?? "").trim(), type: ["FIRST", "SECOND", "SINGLE"].includes(type) ? type : undefined, v });
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 }); }
  const cfg = await getSheetConfig();
  if (typeof body.secret !== "string" || !same(body.secret, cfg.secret)) {
    return NextResponse.json({ ok: false, error: "Wrong key. Copy the script again from Settings." }, { status: 401 });
  }
  const sheet = String(body.sheet) as SheetKind;
  if (!KINDS.includes(sheet)) return NextResponse.json({ ok: false, error: "Unknown sheet" }, { status: 400 });

  try {
    if (action === "pull") return NextResponse.json({ ok: true, ops: await pullOps(sheet) });
    if (action === "ack") {
      await ackOps(sheet, (body.results as never[]) ?? []);
      revalidatePath("/", "layout");
      return NextResponse.json({ ok: true });
    }
    if (action !== "push") return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 404 });

    const tabs = (body.tabs as { tab: string; rows: unknown[][] }[]) ?? [];
    const done: string[] = [];
    const skipped: string[] = [];
    for (const t of tabs) {
      const rows = Array.isArray(t.rows) ? t.rows : [];
      if (sheet === "log") {
        const date = logTabDate(String(t.tab));
        const head = (rows[0] ?? []).map((c) => String(c ?? "").toLowerCase());
        // Only day tabs with today's 24-column layout (the oldest tabs differ and stay as imported).
        if (!date || !head[1]?.includes("content title") || !head[12]?.includes("status")) { skipped.push(t.tab); continue; }
        // Row 1 is the header, column A is SN.
        const r = await importLogDay(date, rows.slice(1).map((x) => x.slice(1)), { full: true });
        done.push(`${t.tab}: ${r.saved} rows`);
      } else {
        const company = await companyByName(String(t.tab));
        if (!company) { skipped.push(t.tab); continue; }
        if (sheet === "recruitment") {
          const r = await importRecruitment(company, recRows(rows), { full: true, chains: !!cfg.last?.recruitment });
          done.push(`${t.tab}: ${r.created} new, ${r.updated} updated${r.removed ? `, ${r.removed} removed` : ""}`);
        } else {
          const r = await importBroadcast(company, blRows(rows));
          done.push(`${t.tab}: ${r.slots} call days`);
        }
      }
    }
    if (done.length) {
      await patchSheetConfig((c) => {
        const url = typeof body.url === "string" && body.url.startsWith("https://docs.google.com/") ? body.url : c.last?.[sheet]?.url;
        (c.last ??= {})[sheet] = { url, at: new Date().toISOString(), tab: tabs.length === 1 ? tabs[0].tab : `${done.length} tabs`, summary: done.slice(0, 6).join(" · ") };
      });
      revalidatePath("/", "layout");
    }
    return NextResponse.json({ ok: true, done, skipped });
  } catch (e) {
    console.error("sheet sync", e);
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
