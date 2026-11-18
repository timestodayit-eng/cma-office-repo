import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { getTimelineSettings } from "@/lib/workflow";
import { Flash } from "@/components/TaskCard";
import { saveSettingsAction } from "@/app/actions";

const COMPANY_ROLES: [string, string, number][] = [
  ["writer", "Content writer / artist", 1],
  ["model", "Model / promoter (publishes)", 1],
  ["editor", "Video editors", 2],
  ["qc", "QC person", 1],
  ["ads", "Ads runner", 1],
  ["broadcast_officer", "Broadcast officer", 1],
  ["uploader", "Uploader", 1],
];
const GLOBAL: [string, string][] = [
  ["creative_lead", "Creative Lead"],
  ["content_director", "Content Director"],
  ["cinematographer", "Cinematographer"],
];

export default async function Settings({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireModule("settings");
  const sp = await searchParams;
  const [t, companies, users, roles] = await Promise.all([
    getTimelineSettings(),
    prisma.company.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.companyRole.findMany(),
  ]);
  const holders = (companyId: string | null, role: string) => roles.filter((r) => r.companyId === companyId && r.role === role).map((r) => r.userId);
  const Pick = ({ name, value }: { name: string; value?: string }) => (
    <select name={name} defaultValue={value ?? ""} className="inp"><option value="">—</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
  );
  return (
    <>
      <h1 className="h1">Settings</h1>
      <Flash sp={sp} />
      <form action={saveSettingsAction} className="stack">
        <fieldset disabled={!u.can("settings", "EDIT")} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <b>Timeline days</b>
            <p className="hint">Counted back from the interview date. Changes apply to new interviews.</p>
            <div className="two">
              <label className="field">Ads start, days before interview<input type="number" name="adsDaysBefore" defaultValue={t.adsDaysBefore} min={1} max={30} /></label>
              <label className="field">Writer is told, days before ads<input type="number" name="writerDaysBeforeAds" defaultValue={t.writerDaysBeforeAds} min={1} max={30} /></label>
              <label className="field">Handover to marketing, days before ads<input type="number" name="handoverDaysBeforeAds" defaultValue={t.handoverDaysBeforeAds} min={0} max={10} /></label>
              <label className="field">Shoot, days before handover<input type="number" name="shootDaysBeforeHandover" defaultValue={t.shootDaysBeforeHandover} min={1} max={15} /></label>
            </div>
          </div>
          <div className="card">
            <b>Team roles</b>
            <div className="two">
              {GLOBAL.map(([k, label]) => (
                <label key={k} className="field">{label}<Pick name={`role_global_${k}`} value={holders(null, k)[0]} /></label>
              ))}
            </div>
          </div>
          <div className="card">
            <b>Who does what, per company</b>
            <div className="tblwrap" style={{ maxHeight: "none" }}>
              <table className="tbl">
                <thead><tr><th>Job</th>{companies.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
                <tbody>
                  {COMPANY_ROLES.map(([k, label, n]) => (
                    <tr key={k}>
                      <td>{label}</td>
                      {companies.map((c) => {
                        const h = holders(c.id, k);
                        return (
                          <td key={c.id}><div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {Array.from({ length: n }, (_, i) => <Pick key={i} name={`role_${c.id}_${k}`} value={h[i]} />)}
                          </div></td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button className="btn primary" style={{ alignSelf: "flex-start" }}>Save settings</button>
        </fieldset>
      </form>
    </>
  );
}
