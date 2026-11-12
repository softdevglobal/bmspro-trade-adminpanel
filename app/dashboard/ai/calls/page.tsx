import { redirect } from "next/navigation";

export default function AiCallsPage() {
  redirect("/dashboard/call-recordings?view=ai");
}
