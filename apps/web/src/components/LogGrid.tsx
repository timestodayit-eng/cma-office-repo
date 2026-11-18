"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { LOG_COL_DEFS, ROW_COLOR, inkOn } from "@/lib/logLists";
import { saveLogCell } from "@/app/logActions";

export type GridRow = { id?: string; rowIndex: number; cells: Record<string, string> };

const isUrl = (v: string) => /^https?:\/\//i.test(v);
const BLANKS = 15;

/** The day tab as a sheet: click a cell to type, Enter goes down, Tab goes right. */
export function LogGrid({ date, rows: initial, canEdit }: { date: string; rows: GridRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState(initial);
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const [f, setF] = useState({ co: "", st: "", q: "" });
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [extra, setExtra] = useState(0);
  const [, start] = useTransition();
  const skipBlur = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pending = useRef(new Map<number, Promise<string | undefined>>());

  // Real rows first (by sheet position), then empty rows to type into.
  const view = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
    let next = sorted.length ? sorted[sorted.length - 1].rowIndex + 1 : 0;
    const blanks: GridRow[] = Array.from({ length: BLANKS + extra }, () => ({ rowIndex: next++, cells: {} }));
    return [...sorted, ...blanks];
  }, [rows, extra]);
  const match = (r: GridRow) =>
    !r.id || ((!f.co || r.cells.company === f.co) && (!f.st || r.cells.status === f.st) && (!f.q || (r.cells.title ?? "").toLowerCase().includes(f.q.toLowerCase())));
  const shown = view.filter(match);
  const filled = rows.filter((r) => r.cells.title).length;

  function commit(r: GridRow, c: number, raw: string) {
    const col = LOG_COL_DEFS[c];
    const value = raw.trim();
    if ((r.cells[col.key] ?? "") === value) return;
    const key = r.rowIndex;
    setRows((prev) => {
      const at = prev.findIndex((x) => x.rowIndex === key);
      const upd = { ...(at >= 0 ? prev[at] : r), cells: { ...(at >= 0 ? prev[at].cells : {}), [col.key]: value } };
      return at >= 0 ? prev.map((x, i) => (i === at ? upd : x)) : [...prev, upd];
    });
    start(async () => {
      // A new row is saved first, so later cells of the same row go to the same row.
      const cur = (await pending.current.get(key)) ?? r.id;
      const p = saveLogCell({ id: cur, date, rowIndex: key, field: col.key, value });
      if (!cur) pending.current.set(key, p.then((x) => ("id" in x ? x.id : undefined)));
      const res = await p;
      if ("error" in res) return setMsg({ text: res.error ?? "Not saved", bad: true });
      if ("id" in res && res.id) setRows((prev) => prev.map((x) => (x.rowIndex === key ? { ...x, id: res.id } : x)));
      setMsg({ text: "Saved. Goes to the Google Sheet too." });
      setTimeout(() => setMsg(null), 2500);
    });
  }

  function move(r: number, c: number) {
    if (r < 0 || r >= shown.length || c < 0 || c >= LOG_COL_DEFS.length) return setEdit(null);
    setEdit({ r, c });
  }

  const sel = (k: "co" | "st", label: string, list: readonly string[]) => (
    <select className="switch" aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="">{label}</option>{list.map((v) => <option key={v}>{v}</option>)}
    </select>
  );

  return (
    <>
      <div className="logbar">
        {sel("co", "All companies", LOG_COL_DEFS[3].list!)}
        {sel("st", "All status", LOG_COL_DEFS[11].list!)}
        <input className="switch" style={{ maxWidth: "none", flex: 1, minWidth: 110 }} placeholder="Search title…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        {msg && <span className={`hint ${msg.bad ? "bad" : "good"}`}>{msg.text}</span>}
        <span className="hint" style={{ marginLeft: "auto" }}>Total content: <b className="ink">{filled}</b></span>
        {canEdit && <button type="button" className="btn sm" onClick={() => { setExtra(extra + 5); setTimeout(() => wrap.current?.scrollTo({ top: wrap.current.scrollHeight }), 50); }}>+ Row</button>}
        <button type="button" className="btn sm" onClick={(e) => (e.currentTarget.closest(".gs") as HTMLElement | null)?.classList.toggle("full")}>⛶ Full screen</button>
      </div>
      <div className="sheetwrap" ref={wrap}>
        <table className="sheet log">
          <colgroup><col style={{ width: 38 }} />{LOG_COL_DEFS.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
          <thead><tr><th className="rn">SN</th>{LOG_COL_DEFS.map((c) => <th key={c.key} style={{ background: c.color, color: inkOn(c.color) }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.map((row, r) => {
              const sc = ROW_COLOR[row.cells.status ?? ""];
              let sn = 0;
              if (row.cells.title) sn = view.filter((x) => x.cells.title && x.rowIndex <= row.rowIndex).length;
              return (
                <tr key={row.rowIndex}>
                  <td className="rn">{sn || ""}</td>
                  {LOG_COL_DEFS.map((col, c) => {
                    const v = row.cells[col.key] ?? "";
                    const editing = edit?.r === r && edit.c === c;
                    const style = sc ? { background: sc[0], color: sc[1] } : undefined;
                    if (editing) {
                      const onKey = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
                        if (e.key === "Escape") { skipBlur.current = true; setEdit(null); }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          skipBlur.current = true;
                          commit(row, c, e.currentTarget.value);
                          if (e.key === "Enter") move(r + 1, c); else move(r, c + (e.shiftKey ? -1 : 1));
                        }
                      };
                      const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
                        if (skipBlur.current) { skipBlur.current = false; return; }
                        commit(row, c, e.currentTarget.value); setEdit(null);
                      };
                      return (
                        <td key={col.key} className="edit" style={style}>
                          {col.kind === "list" ? (
                            <select className="le" autoFocus defaultValue={v} onKeyDown={onKey} onBlur={onBlur} onChange={(e) => { skipBlur.current = true; commit(row, c, e.currentTarget.value); setEdit(null); }}>
                              <option value="" />{[...new Set([...(col.list ?? []), v].filter(Boolean))].map((o) => <option key={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input className="le" autoFocus defaultValue={v} placeholder={col.kind === "link" ? "Paste link" : ""} onKeyDown={onKey} onBlur={onBlur} onFocus={(e) => e.currentTarget.select()} />
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className={canEdit ? "edit" : "lock"} style={style} title={v} onClick={canEdit ? () => setEdit({ r, c }) : undefined}>
                        {col.kind === "list" ? (v ? <span className="dd"><span>{v}</span><i>▾</i></span> : canEdit ? <span className="dd0">▾</span> : null)
                          : col.kind === "link" && isUrl(v) ? <><a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Link ↗</a>{canEdit && <span className="pen"> ✎</span>}</>
                          : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
