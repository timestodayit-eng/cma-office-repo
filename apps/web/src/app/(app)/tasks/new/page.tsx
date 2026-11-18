import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Flash } from "@/components/TaskCard";
import { createSimpleTaskAction } from "@/app/actions";

export default async function NewTask({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [users, companies] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <>
      <h1 className="h1">New task</h1>
      <p className="hint">For any work outside an interview timeline. Interview videos are made automatically from <b>Interviews → New interview</b>.</p>
      <Flash sp={sp} />
      <form className="card stack" action={createSimpleTaskAction} style={{ maxWidth: 560 }}>
        <label className="field">What needs to be done<input name="title" required /></label>
        <label className="field">Details<textarea name="description" /></label>
        <div className="two">
          <label className="field">Who does it
            <select name="assigneeId" required><option value="">Pick a person</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <label className="field">Who checks it (optional)
            <select name="checkerId"><option value="">Nobody</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <label className="field">Company
            <select name="companyId"><option value="">None</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="field">Deadline<input type="date" name="dueDate" /></label>
        </div>
        <button className="btn primary">Create and notify</button>
      </form>
    </>
  );
}
