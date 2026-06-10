"use client";

import type { ReactNode } from "react";

type SettingsSectionProps = {
  title: string;
  description?: string;
  icon?: string;
  children: ReactNode;
  className?: string;
};

export function SettingsSection({
  title,
  description,
  icon,
  children,
  className = "",
}: SettingsSectionProps) {
  return (
    <section
      className={`rounded-2xl border border-outline-variant/80 bg-surface-container-lowest shadow-sm ${className}`}
    >
      <div className="border-b border-outline-variant/50 px-4 py-3.5 sm:px-6 sm:py-4">
        <div className="flex items-start gap-3">
          {icon ? (
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-primary sm:text-[22px]">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="font-display text-[16px] font-semibold text-on-surface sm:text-[17px]">
              {title}
            </h3>
            {description ? (
              <p className="mt-1 font-body text-[12px] leading-relaxed text-on-surface-variant sm:text-[13px]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-4 py-4 sm:px-6 sm:py-5">{children}</div>
    </section>
  );
}
