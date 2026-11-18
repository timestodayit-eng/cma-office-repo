import { requireModule } from "@/lib/auth";
import { Later } from "@/components/Later";

export default async function Command() {
  await requireModule("ai");
  return <Later title="Command Center" phase={5} when="Comes with the AI phase" points={[
    "Type or speak, in Bangla or English: for example “Coastal-e Malaysia interview 12 Dec”.",
    "Managers give a command and the work is created and handed to the right people.",
    "Anyone can ask a question; the answer comes from all the app data (tasks, log sheet, recruitment, broadcast).",
  ]} />;
}
