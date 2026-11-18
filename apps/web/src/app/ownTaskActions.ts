"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Own tasks are private: every action only ever touches rows of the signed-in person.
const where = (f: FormData) => (f.get("back") === "home" ? "/" : "/tasks?tab=own");
function done(f: FormData, e?: string): never {
  revalidatePath("/", "layout");
  const to = where(f);
  redirect(e ? `${to}${to.includes("?") ? "&" : "?"}${new URLSearchParams({ e })}` : to);
}

export async function ownAddAction(f: FormData) {
  const me = await requireUser();
  const title = (f.get("title")?.toString() ?? "").trim().slice(0, 200);
  if (!title) done(f, "Write the task first");
  const d = f.get("dueDate")?.toString() ?? "";
  await prisma.ownTask.create({ data: { userId: me.id, title, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00Z") : null } });
  done(f);
}

export async function ownSetAction(f: FormData) {
  const me = await requireUser();
  const id = f.get("id")?.toString() ?? "", mode = f.get("mode");
  if (mode === "delete") await prisma.ownTask.deleteMany({ where: { id, userId: me.id } });
  else if (mode === "clear") await prisma.ownTask.deleteMany({ where: { userId: me.id, doneAt: { not: null } } });
  else await prisma.ownTask.updateMany({ where: { id, userId: me.id }, data: { doneAt: mode === "undo" ? null : new Date() } });
  done(f);
}
