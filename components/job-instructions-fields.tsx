"use client";

import {
  JOB_INSTRUCTION_DESCRIPTION_MAX,
  JOB_INSTRUCTION_TASK_MAX,
  JOB_INSTRUCTION_TASKS_MAX,
} from "@/lib/bookings/job-instructions";

const inputClass =
  "w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60";

export function JobInstructionsFields({
  description,
  tasks,
  disabled,
  onDescriptionChange,
  onTasksChange,
}: {
  description: string;
  tasks: string[];
  disabled?: boolean;
  onDescriptionChange: (value: string) => void;
  onTasksChange: (value: string[]) => void;
}) {
  function updateTask(index: number, value: string) {
    const next = [...tasks];
    next[index] = value;
    onTasksChange(next);
  }

  function addTask() {
    if (tasks.length >= JOB_INSTRUCTION_TASKS_MAX) return;
    onTasksChange([...tasks, ""]);
  }

  function removeTask(index: number) {
    onTasksChange(tasks.filter((_, i) => i !== index));
  }

  return (
    <section className="rounded-xl border border-amber-300/50 bg-amber-50/60 p-3">
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined mt-0.5 text-[20px] text-amber-800">
          assignment
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14px] font-semibold text-amber-950">
            Job instructions
          </p>
          <p className="mt-0.5 font-body text-[12px] leading-snug text-amber-900/80">
            Internal briefing for your team — visible to staff and admin only,
            not sent to the customer.
          </p>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-amber-900/70">
          Description
        </span>
        <textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={3}
          maxLength={JOB_INSTRUCTION_DESCRIPTION_MAX}
          placeholder="e.g. Customer prefers side gate access. Meter box is behind the shed."
          disabled={disabled}
          className={`${inputClass} mt-1 resize-y`}
        />
      </label>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-amber-900/70">
            Task list
          </span>
          <button
            type="button"
            onClick={addTask}
            disabled={disabled || tasks.length >= JOB_INSTRUCTION_TASKS_MAX}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-400/50 bg-white/80 px-2.5 py-1 font-body text-[12px] font-semibold text-amber-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add task
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="mt-2 font-body text-[12px] text-amber-900/70">
            Add checklist steps so staff know what to do on site.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {tasks.map((task, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200/70 font-body text-[11px] font-bold text-amber-950">
                  {index + 1}
                </span>
                <input
                  type="text"
                  value={task}
                  onChange={(event) => updateTask(index, event.target.value)}
                  maxLength={JOB_INSTRUCTION_TASK_MAX}
                  placeholder="Task description"
                  disabled={disabled}
                  aria-label={`Task ${index + 1}`}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeTask(index)}
                  disabled={disabled}
                  aria-label={`Remove task ${index + 1}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-amber-900/70 transition-colors hover:bg-amber-200/50 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    close
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function normalizeInstructionTasksForSubmit(tasks: string[]): string[] {
  return tasks
    .map((task) => task.trim())
    .filter((task) => task.length > 0)
    .slice(0, JOB_INSTRUCTION_TASKS_MAX);
}
