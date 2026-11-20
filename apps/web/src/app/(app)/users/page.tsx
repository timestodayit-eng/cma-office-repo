import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { LEVEL_LABEL, type Level } from "@cma/core";
import { initials } from "@/lib/format";

export default async function Users() {
  const u = await requireModule("users");
  const users = await prisma.user.findMany({ include: { responsibilities: true }, orderBy: [{ department: "asc" }, { name: "asc" }] });
  const byDept = new Map<string, typeof users>();
  for (const x of users) byDept.set(x.department ?? "Other", [...(byDept.get(x.department ?? "Other") ?? []), x]);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="h1">Users &amp; Permissions</h1>
        {u.can("users", "EDIT") && <Link href="/users/new" className="btn primary sm">+ New user</Link>}
      </div>
      {[...byDept].map(([dept, list]) => (
        <div key={dept}>
          <div className="h2">{dept} <small>{list.length}</small></div>
          <div className="list">
            {list.map((x) => (
              <Link key={x.id} href={`/users/${x.id}`} className="li" style={{ opacity: x.active ? 1 : 0.5 }}>
                <span className="av sm">{initials(x.name)}</span>
                <span className="grow"><b>{x.name}</b><span>{x.designation} · {x.responsibilities.length} responsibilities</span></span>
                <span className="pill p-grey">{LEVEL_LABEL[x.level as Level]}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
