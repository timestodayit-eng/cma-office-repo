import { requireModule } from "@/lib/auth";
import { Later } from "@/components/Later";

export default async function Performance() {
  await requireModule("performance");
  return <Later title="Performance" phase={5} when="Comes after attendance" points={[
    "A score per person from their job description KPIs, on-time work, QC results and attendance.",
    "Managers see the team; each person sees their own.",
  ]} />;
}
