import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { LEVELS, LEVEL_LABEL, MODULES, RESPONSIBILITY_GROUPS, CONTENT_TYPES } from "@cma/core";
import { Flash } from "@/components/TaskCard";
import { saveUserAction } from "@/app/actions";

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }) {
  const me = await requireModule("users");
  const { id } = await params;
  const sp = await searchParams;
  const [x, companies] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { permissions: true, responsibilities: true } }),
    prisma.company.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  if (!x) notFound();
  const perm = Object.fromEntries(x.permissions.map((p) => [p.module, p.access]));
  const resp = new Map(x.responsibilities.map((r) => [r.key, r]));
  const editable = me.can("users", "EDIT") && (x.level !== "SUPER_ADMIN" || me.level === "SUPER_ADMIN");
  return (
    <>
      <Link href="/users" className="small">← Users</Link>
      <h1 className="h1">{x.name}</h1>
      <Flash sp={sp} />
      <form action={saveUserAction} className="stack">
        <input type="hidden" name="id" value={x.id} />
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <b>Details</b>
            <div className="two">
              <label className="field">Name<input name="name" defaultValue={x.name} /></label>
              <label className="field">Phone (login)<input name="phone" defaultValue={x.phone} /></label>
              <label className="field">WhatsApp<input name="whatsapp" defaultValue={x.whatsapp ?? ""} /></label>
              <label className="field">Level
                <select name="level" defaultValue={x.level}>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select>
              </label>
              <label className="field">Department<input name="department" defaultValue={x.department ?? ""} /></label>
              <label className="field">Designation<input name="designation" defaultValue={x.designation ?? ""} /></label>
              <label className="field">Set a new password (optional)<input name="newPassword" type="text" /></label>
            </div>
            <div className="row small">
              <label className="row"><input type="checkbox" name="active" defaultChecked={x.active} /> Active (can log in)</label>
              <label className="row"><input type="checkbox" name="external" defaultChecked={x.external} /> Support partner (no attendance / payroll)</label>
            </div>
          </div>

          <div className="card">
            <b>Module access</b>
            <div className="tblwrap" style={{ maxHeight: "none" }}>
              <table className="tbl perm">
                <thead><tr><th>Module</th><th>Off</th><th>View</th><th>Edit</th></tr></thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      {(["OFF", "VIEW", "EDIT"] as const).map((a) => (
                        <td key={a}><input type="radio" name={`perm_${m.key}`} value={a} defaultChecked={(perm[m.key] ?? "OFF") === a} aria-label={`${m.label} ${a}`} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {x.level === "SUPER_ADMIN" && <p className="hint">Super Admin always has full access.</p>}
          </div>

          <div className="card">
            <b>Responsibilities</b>
            <p className="hint">Who does which job. Per-company jobs (writer, editor, ads...) are also set company by company in Settings, which decides who gets each interview step.</p>
            {RESPONSIBILITY_GROUPS.map((g) => (
              <div key={g.group} className="grp">
                <h4>{g.group}</h4>
                {g.items.map((r) => {
                  const cur = resp.get(r.key);
                  return (
                    <div key={r.key} className="resp">
                      <input type="checkbox" name={`resp_${r.key}`} defaultChecked={!!cur} id={`r_${r.key}`} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <label htmlFor={`r_${r.key}`}>{r.label}</label>
                        {"perCompany" in r && r.perCompany && (
                          <div className="row small muted">
                            {companies.map((c) => (
                              <label key={c.id} className="row"><input type="checkbox" name={`resp_${r.key}_co_${c.id}`} defaultChecked={cur?.companies.includes(c.id)} />{c.short}</label>
                            ))}
                            <span>(none ticked = all)</span>
                          </div>
                        )}
                        {"perContentType" in r && r.perContentType && (
                          <div className="row small muted">
                            {CONTENT_TYPES.map((ct) => (
                              <label key={ct} className="row"><input type="checkbox" name={`resp_${r.key}_ct`} value={ct} defaultChecked={cur?.contentTypes.includes(ct)} />{ct}</label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {editable && <button className="btn primary" style={{ alignSelf: "flex-start" }}>Save</button>}
        </fieldset>
      </form>
    </>
  );
}
