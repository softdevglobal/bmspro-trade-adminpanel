"use client";

import Link from "next/link";

type FollowUpActionButtonsProps = {
  onBook?: () => void;
  onWait?: () => void;
  bookHref?: string;
  waitHref?: string;
  showWait?: boolean;
  className?: string;
};

const bookClassName =
  "inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-2.5 font-body text-[11px] font-semibold text-on-primary transition-colors hover:bg-primary/90";

const waitClassName =
  "inline-flex h-7 items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-2.5 font-body text-[11px] font-semibold text-orange-800 transition-colors hover:bg-orange-100";

export function FollowUpActionButtons({
  onBook,
  onWait,
  bookHref,
  waitHref,
  showWait = true,
  className = "",
}: FollowUpActionButtonsProps) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {bookHref ? (
        <Link href={bookHref} className={bookClassName} title="Create booking">
          <span className="material-symbols-outlined text-[12px] leading-none">
            assignment
          </span>
          Book
        </Link>
      ) : (
        <button type="button" onClick={onBook} className={bookClassName} title="Create booking">
          <span className="material-symbols-outlined text-[12px] leading-none">
            assignment
          </span>
          Book
        </button>
      )}
      {showWait ? (
        waitHref ? (
          <Link href={waitHref} className={waitClassName} title="Mark awaiting decision">
            <span className="material-symbols-outlined text-[12px] leading-none">
              pending_actions
            </span>
            Wait
          </Link>
        ) : (
          <button
            type="button"
            onClick={onWait}
            className={waitClassName}
            title="Mark awaiting decision"
          >
            <span className="material-symbols-outlined text-[12px] leading-none">
              pending_actions
            </span>
            Wait
          </button>
        )
      ) : null}
    </div>
  );
}
