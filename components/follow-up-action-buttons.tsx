"use client";

import { ADMIN_COPY } from "@/lib/copy/product-language";
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

/**
 * Waiting on the customer is a "not confirmed yet" state, so it reads amber
 * rather than as a neutral secondary action.
 */
const waitClassName = `${pillBase} border border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100`;

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
        <Link
          href={bookHref}
          className={bookClassName}
          title="Create a confirmed job from this quotation"
        >
          {ADMIN_COPY.scheduleJob}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onBook}
          className={bookClassName}
          title="Create a confirmed job from this quotation"
        >
          {ADMIN_COPY.scheduleJob}
        </button>
      )}
      {showWait ? (
        waitHref ? (
          <Link
            href={waitHref}
            className={waitClassName}
            title="Mark as waiting for the customer to decide"
          >
            {ADMIN_COPY.waitingForCustomer}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onWait}
            className={waitClassName}
            title="Mark as waiting for the customer to decide"
          >
            {ADMIN_COPY.waitingForCustomer}
          </button>
        )
      ) : null}
    </div>
  );
}
