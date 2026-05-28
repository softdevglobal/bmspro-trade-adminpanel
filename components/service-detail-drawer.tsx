"use client";

import {
  formatServiceDuration,
  type BusinessServiceDetail,
  type ServiceTemplateDetail,
} from "@/lib/onboarding/services/display";
import { iconForServiceSkill } from "@/lib/onboarding/services/types";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

export type ServiceViewTarget =
  | { type: "template"; record: ServiceTemplateDetail }
  | { type: "service"; record: BusinessServiceDetail };

type Props = {
  target: ServiceViewTarget | null;
  onClose: () => void;
};

const panelTransition = {
  type: "spring" as const,
  damping: 32,
  stiffness: 340,
  mass: 0.85,
};

const ACTIVE_BADGE =
  "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20";
const INACTIVE_BADGE =
  "bg-surface-container-high text-on-surface-variant border border-outline-variant/40";

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ServiceDetailDrawer({ target, onClose }: Props) {
  const open = target !== null;

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence mode="wait">
      {target ? (
        <DrawerPanel key={`${target.type}-${target.record.id}`} target={target} onClose={onClose} />
      ) : null}
    </AnimatePresence>
  );
}

function DrawerPanel({
  target,
  onClose,
}: {
  target: ServiceViewTarget;
  onClose: () => void;
}) {
  const isTemplate = target.type === "template";
  const record = target.record;
  const name = record.name;
  const iconSkill = isTemplate
    ? target.record.businessType
    : target.record.requiredSkill;

  return (
    <div className="fixed inset-0 z-[100]">
      <motion.button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="absolute inset-0 bg-on-background/45 backdrop-blur-[2px]"
      />

      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-detail-title"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={panelTransition}
        className="absolute inset-y-0 right-0 flex w-[calc(100%-1.25rem)] max-w-md flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-outline-variant bg-background shadow-2xl will-change-transform sm:w-full sm:rounded-none sm:border-y-0 sm:border-r-0 sm:border-l"
      >
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.28, ease: "easeOut" }}
          className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant px-5 py-4"
        >
          <div className="flex min-w-0 items-start gap-3">
            {target.type === "service" && target.record.imageUrl ? (
              <img
                src={target.record.imageUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-xl border border-outline-variant object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[24px]">
                  {iconForServiceSkill(iconSkill)}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <h2
                id="service-detail-title"
                className="truncate font-display text-headline-sm font-semibold text-on-surface"
              >
                {name || (isTemplate ? "Template details" : "Service details")}
              </h2>
              <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
                {isTemplate ? "Service template" : "Business service"}
              </p>
              <span
                className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold ${
                  record.isActive ? ACTIVE_BADGE : INACTIVE_BADGE
                }`}
              >
                {record.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.32, ease: "easeOut" }}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          <DetailSection title={isTemplate ? "Template" : "Service"}>
            {isTemplate ? (
              <>
                <DetailRow label="Name" value={target.record.name} />
                <DetailRow label="Trade type" value={target.record.businessType} />
              </>
            ) : (
              <>
                <DetailRow label="Name" value={target.record.name} />
                <DetailRow
                  label="Business type"
                  value={target.record.businessType || "—"}
                />
                <DetailRow
                  label="Source"
                  value={
                    target.record.templateId
                      ? "Created from template"
                      : "Custom service"
                  }
                />
              </>
            )}
            {!isTemplate && target.type === "service" ? (
              <>
                <DetailRow
                  label="Required skill"
                  value={target.record.requiredSkill || "—"}
                />
                <DetailRow
                  label="Default duration"
                  value={formatServiceDuration(target.record.defaultDurationMin)}
                />
              </>
            ) : null}
          </DetailSection>

          <DetailSection title="Tasks">
            {record.tasks.length > 0 ? (
              <ul className="divide-y divide-outline-variant/60">
                {record.tasks.map((task, index) => (
                  <li key={task.id} className="px-4 py-3">
                    <p className="font-body text-[13px] font-semibold text-on-surface">
                      {index + 1}. {task.title}
                    </p>
                    {task.description ? (
                      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                        {task.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <DetailRow label="Checklist" value="No tasks defined" />
            )}
          </DetailSection>

          <DetailSection title="Record">
            <DetailRow
              label="Created"
              value={formatDate(record.createdAt)}
            />
            <DetailRow
              label="Last updated"
              value={formatDate(record.updatedAt)}
            />
          </DetailSection>
        </motion.div>
      </motion.aside>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </h3>
      <dl className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant bg-surface-container-lowest">
        {children}
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="shrink-0 font-body text-[12px] font-semibold text-on-surface-variant">
        {label}
      </dt>
      <dd className="font-body text-[13px] text-on-surface sm:max-w-[58%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}
