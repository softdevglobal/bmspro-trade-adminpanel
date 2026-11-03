import type { Metadata } from "next";

export const metadata: Metadata = { title: "Unanswered questions - BMS Pro Trade" };

export default function AiUnansweredPage() {
  return (
    <section className="p-6">
      <h1 className="font-display text-2xl font-semibold text-on-surface">Unanswered questions</h1>
    </section>
  );
}
