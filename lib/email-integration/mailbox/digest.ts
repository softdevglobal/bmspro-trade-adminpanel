/**
 * Pure wording for the half-hourly email digest push. Email text comes from outside the business, so the
 * sender and subject are cleaned and clipped, and the body is never included.
 */

const clean = (value: string, max: number) => {
  const text = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

function lines(count: number, latest: { from: string; subject: string }[]): string {
  const shown = latest.slice(0, 3).map((mail) => `${clean(mail.from, 30)}: ${clean(mail.subject, 50)}`);
  const more = count - shown.length;
  return [...shown, ...(more > 0 ? [`and ${more} more`] : [])].join("\n");
}

/** Title and body of the push, or null when nothing new arrived. */
export function digestMessage(
  count: number,
  latest: { from: string; subject: string }[],
): { title: string; body: string } | null {
  if (count <= 0) return null;
  return { title: `${count} new unread email${count === 1 ? "" : "s"}`, body: lines(count, latest) };
}

/**
 * When Sophie sorts the mail, the digest only covers emails waiting for the owner that didn't get
 * a push of their own, so nothing is announced twice. Null when there are none.
 */
export function waitingDigestMessage(
  count: number,
  latest: { from: string; subject: string }[],
): { title: string; body: string } | null {
  if (count <= 0) return null;
  return { title: `${count} email${count === 1 ? " is" : "s are"} waiting for you`, body: lines(count, latest) };
}
