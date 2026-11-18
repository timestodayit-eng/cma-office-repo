import { requireUser } from "@/lib/auth";
import { LEVEL_LABEL, ALL_RESPONSIBILITIES, type Level } from "@cma/core";
import { Flash } from "@/components/TaskCard";
import { changePasswordAction, updateProfileAction } from "@/app/actions";

export default async function Profile({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const resp = ALL_RESPONSIBILITIES.filter((r) => u.resp.has(r.key));
  return (
    <>
      <h1 className="h1">{u.name}</h1>
      <div className="row small muted"><span className="pill p-pri">{LEVEL_LABEL[u.level as Level]}</span><span>{u.designation}</span><span>{u.department}</span><span>{u.phone}</span></div>
      <Flash sp={sp} />
      <div className="grid">
        <div className="card">
          <b>My responsibilities</b>
          {resp.length ? resp.map((r) => <div key={r.key} className="small">• {r.label} <span className="muted">({r.group})</span></div>) : <span className="hint">None set yet.</span>}
        </div>
        <form className="card stack" action={updateProfileAction}>
          <b>WhatsApp</b>
          <p className="hint">Tasks, requests and QC notes also reach you on WhatsApp once the office has connected its WhatsApp number.</p>
          <label className="field">WhatsApp number<input name="whatsapp" defaultValue={u.whatsapp ?? ""} /></label>
          <label className="row small"><input type="checkbox" name="whatsappOn" defaultChecked={u.whatsappOn} /> Send me WhatsApp messages</label>
          <button className="btn">Save</button>
        </form>
        <form className="card stack" action={changePasswordAction}>
          <b>Change password</b>
          <label className="field">Current password<input name="current" type="password" required /></label>
          <label className="field">New password<input name="next" type="password" minLength={6} required /></label>
          <button className="btn">Change</button>
        </form>
      </div>
    </>
  );
}
