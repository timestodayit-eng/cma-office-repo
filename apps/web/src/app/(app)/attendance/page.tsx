import { requireModule } from "@/lib/auth";
import { Later } from "@/components/Later";

export default async function Attendance() {
  await requireModule("attendance");
  return <Later title="Attendance" phase={3} when="Comes with the mobile app" points={[
    "Check in and out from the phone, only on office WiFi or at the office location.",
    "Late, remote, leave and overtime, with approval by management.",
    "Team view for today and each person's month.",
  ]} />;
}
