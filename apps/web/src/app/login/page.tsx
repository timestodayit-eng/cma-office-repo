import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { loginAction } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await getUser()) redirect("/");
  const { e } = await searchParams;
  return (
    <div className="login">
      <form className="card" action={loginAction}>
        <div className="brand" style={{ padding: 0 }}>
          <b style={{ fontFamily: "var(--f-display)", fontSize: 22 }}>CMA Office</b>
          <span className="muted small">Creative · Coastal · SM</span>
        </div>
        {e && <div className="err">Phone number or password is wrong.</div>}
        <label className="field">Phone number
          <input name="phone" inputMode="tel" autoComplete="username" required placeholder="01XXXXXXXXX" />
        </label>
        <label className="field">Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn primary">Log in</button>
      </form>
    </div>
  );
}
