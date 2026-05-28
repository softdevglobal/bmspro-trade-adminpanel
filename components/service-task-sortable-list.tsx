"use client";

import { useRef, useState } from "react";

export type WizardTask = {
  clientKey: string;
  title: string;
  description: string;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function createWizardTask(
  partial?: Partial<Pick<WizardTask, "title" | "description">>,
): WizardTask {
  return {
    title: "",
    description: "",
    ...partial,
    clientKey: crypto.randomUUID(),
  };
}

export function wizardTasksFromInputs(
  tasks: { title: string; description: string }[],
): WizardTask[] {
  return tasks.map((task) => createWizardTask(task));
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
        {optional && (
          <span className="font-normal text-outline"> (optional)</span>
        )}
      </span>
      {children}
    </label>
  );
}

type Props = {
  tasks: WizardTask[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onUpdate: (index: number, patch: Partial<Pick<WizardTask, "title" | "description">>) => void;
  onRemove: (index: number) => void;
};

export function ServiceTaskSortableList({
  tasks,
  onReorder,
  onUpdate,
  onRemove,
}: Props) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  function handleDragStart(
    event: React.DragEvent<HTMLButtonElement>,
    index: number,
    clientKey: string,
  ) {
    setDraggedIndex(index);
    setOverIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    const card = cardRefs.current.get(clientKey);
    if (card) {
      event.dataTransfer.setDragImage(card, 24, 24);
    }
  }

  function handleDragOver(event: React.DragEvent, index: number) {
    event.preventDefault();
    if (draggedIndex === null) return;
    setOverIndex(index);
  }

  function handleDrop(event: React.DragEvent, index: number) {
    event.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      onReorder(draggedIndex, index);
    }
    setDraggedIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setOverIndex(null);
  }

  return (
    <ul className="flex list-none flex-col gap-3 p-0">
      {tasks.map((task, index) => {
        const isDragging = draggedIndex === index;
        const isDropTarget =
          overIndex === index &&
          draggedIndex !== null &&
          draggedIndex !== index;

        return (
          <li
            key={task.clientKey}
            ref={(node) => {
              if (node) cardRefs.current.set(task.clientKey, node);
              else cardRefs.current.delete(task.clientKey);
            }}
            onDragOver={(event) => handleDragOver(event, index)}
            onDrop={(event) => handleDrop(event, index)}
            className={`rounded-xl border bg-surface-container-lowest p-4 transition-all ${
              isDragging
                ? "border-primary/40 opacity-60 shadow-md"
                : isDropTarget
                  ? "border-2 border-primary border-dashed bg-primary-fixed/15"
                  : "border-outline-variant"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  draggable
                  onDragStart={(event) =>
                    handleDragStart(event, index, task.clientKey)
                  }
                  onDragEnd={handleDragEnd}
                  className="flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low active:cursor-grabbing"
                  title="Drag to reorder"
                  aria-label={`Drag to reorder task ${index + 1}`}
                >
                  <span className="material-symbols-outlined text-[22px]">
                    drag_indicator
                  </span>
                </button>
                <p className="font-body text-[13px] font-semibold text-on-surface">
                  Task {index + 1}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="shrink-0 text-on-surface-variant hover:text-error"
                aria-label={`Remove task ${index + 1}`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  delete
                </span>
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Title" required>
                <input
                  type="text"
                  value={task.title}
                  onChange={(event) =>
                    onUpdate(index, { title: event.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Description" optional>
                <textarea
                  value={task.description}
                  onChange={(event) =>
                    onUpdate(index, { description: event.target.value })
                  }
                  rows={2}
                  className={`${INPUT_CLASS} resize-none`}
                />
              </Field>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
