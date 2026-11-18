import { requireModule } from "@/lib/auth";
import { Later } from "@/components/Later";

export default async function Payroll() {
  await requireModule("payroll");
  return <Later title="Payroll" phase={5} when="Comes after attendance" points={[
    "Salary sheet made automatically from attendance, leave and overtime.",
    "Management can edit any line before it is final.",
    "Each person sees only their own pay slip.",
  ]} />;
}
