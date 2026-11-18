import { requireModule } from "@/lib/auth";
import { LEVELS, LEVEL_LABEL } from "@cma/core";
import { Flash } from "@/components/TaskCard";
import { createUserAction } from "@/app/actions";

export default async function NewUser({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const u = await requireModule("users", "EDIT");
  const sp = await searchParams;
  return (
    <>
      <h1 className="h1">New user</h1>
      <p className="hint">After saving you can set module access and responsibilities.</p>
      <Flash sp={sp} />
      <form className="card stack" action={createUserAction} style={{ maxWidth: 560 }}>
        <div className="two">
          <label className="field">Full name<input name="name" required /></label>
          <label className="field">Phone (login)<input name="phone" required inputMode="tel" placeholder="01XXXXXXXXX" /></label>
          <label className="field">Level
            <select name="level" defaultValue="STAFF">{LEVELS.filter((l) => l !== "SUPER_ADMIN" || u.level === "SUPER_ADMIN").map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select>
          </label>
          <label className="field">Department<input name="department" placeholder="Production" /></label>
          <label className="field">Designation<input name="designation" placeholder="Video Editor" /></label>
          <label className="field">First password<input name="password" placeholder="cma12345" /></label>
        </div>
        <button className="btn primary">Create user</button>
      </form>
    </>
  );
}
