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

const pillBase =
  "inline-flex items-center justify-center rounded-full px-3 py-1.5 font-body text-[12px] font-semibold transition-all sm:px-4 sm:py-2 sm:text-[13px]";

const bookClassName = `${pillBase} bg-primary text-on-primary shadow-sm hover:bg-primary/90`;

const waitClassName = `${pillBase} border border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant hover:border-primary/50 hover:text-primary`;

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
      className={`inline-flex flex-wrap items-center gap-2 ${className}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {bookHref ? (
        <Link href={bookHref} className={bookClassName} title="Create job">
          Book
        </Link>
      ) : (
        <button type="button" onClick={onBook} className={bookClassName} title="Create job">
          Book
        </button>
      )}
      {showWait ? (
        waitHref ? (
          <Link href={waitHref} className={waitClassName} title="Mark awaiting decision">
            Wait
          </Link>
        ) : (
          <button
            type="button"
            onClick={onWait}
            className={waitClassName}
            title="Mark awaiting decision"
          >
            Wait
          </button>
        )
      ) : null}
    </div>
  );
}
