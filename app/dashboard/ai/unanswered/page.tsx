import { redirect } from "next/navigation";

/** Unanswered questions are reviewed on the AI knowledge page, next to the entries they become. */
export default function AiUnansweredPage() {
  redirect("/dashboard/ai/knowledge");
}
