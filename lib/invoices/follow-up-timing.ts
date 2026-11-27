/** Temporary test interval. Change this one value when the final policy is agreed. */
export const INVOICE_NO_ANSWER_RETRY_DELAY_MS = 2 * 60_000;
/** One additional call per original invoice-call attempt; never loop indefinitely. */
export const INVOICE_NO_ANSWER_MAX_RETRIES = 1;
