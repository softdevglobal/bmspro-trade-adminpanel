import { hasJobInstructions } from "@/lib/bookings/job-instructions";
import type { BookingDetail } from "@/lib/bookings/types";

export function JobInstructionsDisplay({
  description,
  tasks,
  compact = false,
}: {
  description: string | null;
  tasks: string[];
  compact?: boolean;
}) {
  if (!description?.trim() && tasks.length === 0) return null;

  return (
    <section
      className={`rounded-xl border border-amber-300/60 bg-amber-50/90 ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[18px] text-amber-800">
          assignment
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`font-body font-bold uppercase tracking-wider text-amber-900 ${
                compact ? "text-[10px]" : "text-[11px]"
              }`}
            >
              Job instructions
            </p>
            <span className="rounded-full bg-amber-200/80 px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-amber-950">
              Staff & admin
            </span>
          </div>

          {description?.trim() ? (
            <p
              className={`mt-2 whitespace-pre-line text-amber-950 ${
                compact
                  ? "font-body text-[12px] leading-snug"
                  : "font-body text-[13px] leading-relaxed"
              }`}
            >
              {description.trim()}
            </p>
          ) : null}

          {tasks.length > 0 ? (
            <ol
              className={`mt-2 space-y-1.5 ${
                description?.trim() ? "border-t border-amber-300/40 pt-2" : ""
              }`}
            >
              {tasks.map((task, index) => (
                <li
                  key={`${index}-${task}`}
                  className="flex items-start gap-2 font-body text-[13px] leading-snug text-amber-950"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 font-body text-[10px] font-bold text-amber-950">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">{task}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function JobInstructionsGlance({
  booking,
}: {
  booking: Pick<
    BookingDetail,
    "jobInstructionsDescription" | "jobInstructionsTasks"
  >;
}) {
  if (!hasJobInstructions(booking)) return null;

  const taskCount = booking.jobInstructionsTasks.length;
  const preview =
    booking.jobInstructionsDescription?.trim() ||
    booking.jobInstructionsTasks[0] ||
    "";

  return (
    <div className="flex w-full basis-full flex-wrap items-center gap-2 border-t border-amber-200/60 pt-2">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 font-body text-[11px] font-semibold text-amber-950">
        <span className="material-symbols-outlined text-[14px] text-amber-800">
          assignment
        </span>
        {taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : "Instructions"}
      </span>
      {preview ? (
        <span className="min-w-0 flex-1 truncate font-body text-[12px] text-amber-900/90">
          {preview}
        </span>
      ) : null}
    </div>
  );
}
