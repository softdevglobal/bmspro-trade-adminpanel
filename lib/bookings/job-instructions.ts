import type { BookingDetail } from "@/lib/bookings/types";

export const JOB_INSTRUCTION_DESCRIPTION_MAX = 2000;
export const JOB_INSTRUCTION_TASK_MAX = 200;
export const JOB_INSTRUCTION_TASKS_MAX = 30;

export function parseJobInstructionDescription(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, JOB_INSTRUCTION_DESCRIPTION_MAX);
}

export function parseJobInstructionTasks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tasks: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    tasks.push(trimmed.slice(0, JOB_INSTRUCTION_TASK_MAX));
    if (tasks.length >= JOB_INSTRUCTION_TASKS_MAX) break;
  }
  return tasks;
}

export function parseJobInstructionsFromDoc(data: Record<string, unknown>): {
  jobInstructionsDescription: string | null;
  jobInstructionsTasks: string[];
} {
  const description =
    typeof data.jobInstructionsDescription === "string" &&
    data.jobInstructionsDescription.trim()
      ? data.jobInstructionsDescription.trim()
      : null;
  const tasks = Array.isArray(data.jobInstructionsTasks)
    ? data.jobInstructionsTasks
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];
  return {
    jobInstructionsDescription: description,
    jobInstructionsTasks: tasks,
  };
}

export function hasJobInstructions(
  booking: Pick<
    BookingDetail,
    "jobInstructionsDescription" | "jobInstructionsTasks"
  >,
): boolean {
  return (
    Boolean(booking.jobInstructionsDescription?.trim()) ||
    booking.jobInstructionsTasks.length > 0
  );
}
