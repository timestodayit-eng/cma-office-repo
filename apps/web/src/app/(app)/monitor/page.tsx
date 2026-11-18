import { requireModule } from "@/lib/auth";
import { Later } from "@/components/Later";

export default async function Monitor() {
  await requireModule("monitor");
  return <Later title="Work Monitor" phase={4} when="Comes with the Windows desktop app" points={[
    "Screenshots at the interval the admin sets, plus active, idle and app-usage time.",
    "Only while the person is checked in. They agree on first run and always see a recording sign.",
    "Only admins can see the screenshots.",
  ]} />;
}
