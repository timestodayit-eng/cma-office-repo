"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { cellBg, showCell, type Cell, type RecColDef } from "@/lib/recCols";
import { inkOn } from "@/lib/logLists";
import { saveRecCell } from "@/app/recActions";

export type RecGridRow = { row: number; cells: Cell[] };

/** One agency tab of the Recruitment sheet as a sheet: click a cell to type, Enter goes down, Tab goes right. */
export function RecGrid(props: {
  tab: string; cols: RecColDef[]; rows: RecGridRow[]; keys: { co: number; date: number };
  today: string; soonEnd: string; dup: string[]; canEdit: boolean; canAdd: boolean;
}) {
  const { tab, cols, keys, today, soonEnd, canEdit } = props;
  const [rows, setRows] = useState(props.rows);
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const [f, setF] = useState({ when: "", st: "", q: "" });
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [, start] = useTransition();
  const skipBlur = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const dup = useMemo(() => new Set(props.dup), [props.dup]);
  const statusCol = cols.find((c) => c.label.toLowerCase() === "status");

  const dateOf = (r: RecGridRow) => {
    const d = r.cells[keys.date];
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  };
  const shown = rows.filter((r) => {
    const d = dateOf(r);
    if (f.when === "soon" && !(d && d >= today && d <= soonEnd)) return false;
    if (f.when === "upcoming" && !(d && d >= today)) return false;
    if (f.when === "done" && !(d && d < today)) return false;
    if (f.st && String(r.cells[statusCol?.i ?? -1] ?? "").trim() !== f.st.trim()) return false;
    if (f.q && !r.cells.some((c) => String(c ?? "").toLowerCase().includes(f.q.toLowerCase()))) return false;
    return true;
  });
  // Open at this week's interviews, a few rows above the first one from today on.
  useEffect(() => {
    const w = wrap.current;
    const tr = w?.querySelector<HTMLElement>("tr[data-from-today]");
    if (w && tr) w.scrollTop = Math.max(0, tr.offsetTop - 4 * tr.offsetHeight - 40);
  }, []);
  const firstToday = rows.find((r) => (dateOf(r) ?? "") >= today)?.row;
  const total = rows.filter((r) => String(r.cells[keys.co] ?? "").trim()).length;
  const editable = cols.map((c, i) => (c.edit ? i : -1)).filter((i) => i >= 0);

  function commit(row: RecGridRow, col: RecColDef, raw: string) {
    const old = row.cells[col.i];
    const now = col.kind === "check" ? raw === "true" : raw.trim();
    if (String(old ?? "") === String(now ?? "") || (old == null && now === "")) return;
    setRows((prev) => prev.map((x) => {
      if (x.row !== row.row) return x;
      const cells = [...x.cells]; while (cells.length <= col.i) cells.push(null);
      cells[col.i] = now === "" ? null : now; return { ...x, cells };
    }));
    start(async () => {
      const res = await saveRecCell({ tab, row: row.row, col: col.i, value: String(now) });
      if ("error" in res) return setMsg({ text: res.error ?? "Not saved", bad: true });
      setRows((prev) => prev.map((x) => (x.row === row.row ? { ...x, cells: res.cells } : x)));
      setMsg({ text: "Saved. Goes to the Google Sheet too." });
      setTimeout(() => setMsg(null), 2500);
    });
  }

  function move(r: number, c: number) {
    if (r < 0 || r >= shown.length) return setEdit(null);
    setEdit({ r, c });
  }
  function step(r: number, c: number, dir: 1 | -1) {
    const k = editable.indexOf(c) + dir;
    if (k < 0 || k >= editable.length) return setEdit(null);
    setEdit({ r, c: editable[k] });
  }

  const sel = (k: "when" | "st", label: string, list: readonly (readonly [string, string])[]) => (
    <select className="switch" aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="">{label}</option>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <>
      <div className="logbar">
        {sel("when", "All dates", [["soon", "Next 7 days"], ["upcoming", "Upcoming"], ["done", "Done (past)"]])}
        {statusCol && sel("st", "All status", (statusCol.list ?? []).map((s) => [s, s.trim()] as const))}
        <input className="switch" style={{ maxWidth: "none", flex: 1, minWidth: 110 }} placeholder="Search company, country…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        {msg && <span className={`hint ${msg.bad ? "bad" : "good"}`}>{msg.text}</span>}
        <span className="hint" style={{ marginLeft: "auto" }}>Interviews: <b className="ink">{total}</b></span>
        {props.canAdd && <Link href="/interviews/new" className="btn sm primary">+ New interview</Link>}
        <button type="button" className="btn sm" onClick={(e) => (e.currentTarget.closest(".gs") as HTMLElement | null)?.classList.toggle("full")}>⛶ Full screen</button>
      </div>
      <div className="sheetwrap" ref={wrap}>
        <table className="sheet log rec">
          <colgroup><col style={{ width: 38 }} />{cols.map((c) => <col key={c.i} style={{ width: c.width }} />)}</colgroup>
          <thead><tr><th className="rn">1</th>{cols.map((c) => <th key={c.i} style={{ background: c.head, color: "#fff" }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.map((row, r) => {
              const d = dateOf(row);
              const isDup = dup.has(String(row.cells[keys.co] ?? "").trim().toLowerCase());
              return (
                <tr key={row.row} data-from-today={row.row === firstToday ? "" : undefined}>
                  <td className="rn">{row.row}</td>
                  {cols.map((col, c) => {
                    const v = row.cells[col.i] ?? null;
                    const bg = cellBg(tab, col, d, today, soonEnd, isDup);
                    const style = bg ? { background: bg, color: inkOn(bg) } : undefined;
                    const can = canEdit && col.edit;
                    const editing = edit?.r === r && edit.c === c;
                    if (col.kind === "check") {
                      return (
                        <td key={col.i} className={`ctr ${can ? "edit" : "lock"}`} style={style}>
                          <input type="checkbox" checked={v === true || v === "TRUE"} disabled={!can} onChange={(e) => commit(row, col, String(e.currentTarget.checked))} aria-label={col.label} />
                        </td>
                      );
                    }
                    if (editing && can) {
                      const onKey = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
                        if (e.key === "Escape") { skipBlur.current = true; setEdit(null); }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          skipBlur.current = true;
                          commit(row, col, e.currentTarget.value);
                          if (e.key === "Enter") move(r + 1, c); else step(r, c, e.shiftKey ? -1 : 1);
                        }
                      };
                      const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
                        if (skipBlur.current) { skipBlur.current = false; return; }
                        commit(row, col, e.currentTarget.value); setEdit(null);
                      };
                      const cur = v == null ? "" : String(v);
                      return (
                        <td key={col.i} className="edit" style={style}>
                          {col.kind === "list" ? (
                            <select className="le" autoFocus defaultValue={cur} onKeyDown={onKey} onBlur={onBlur} onChange={(e) => { skipBlur.current = true; commit(row, col, e.currentTarget.value); setEdit(null); }}>
                              <option value="" />{[...new Set([...(col.list ?? []), cur].filter(Boolean))].map((o) => <option key={o} value={o}>{o.trim()}</option>)}
                            </select>
                          ) : (
                            <input className="le" autoFocus type={col.kind === "date" ? "date" : "text"} inputMode={col.kind === "money" ? "decimal" : undefined}
                              defaultValue={cur} onKeyDown={onKey} onBlur={onBlur} onFocus={(e) => e.currentTarget.select?.()} />
                          )}
                        </td>
                      );
                    }
                    const text = showCell(v, col);
                    const centre = col.kind !== "text" && col.kind !== "agency";
                    return (
                      <td key={col.i} className={`${can ? "edit" : "lock"}${centre ? " ctr" : ""}`} style={style} title={text} onClick={can ? () => setEdit({ r, c }) : undefined}>
                        {col.kind === "list" ? (text ? <span className="dd"><span>{text.trim()}</span>{can && <i>▾</i>}</span> : can ? <span className="dd0">▾</span> : null) : text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!shown.length && <tr><td className="rn" /><td colSpan={cols.length} className="muted">No rows match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
