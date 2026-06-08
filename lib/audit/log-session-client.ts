/** Best-effort client helper for POST /api/audit/session (login / logout). */
export async function postSessionAudit(
  token: string,
  event: "login" | "logout",
  options?: { bookingSlug?: string },
): Promise<void> {
  try {
    await fetch("/api/audit/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event,
        bookingSlug: options?.bookingSlug?.trim() || undefined,
      }),
    });
  } catch {
    /* audit is best-effort */
  }
}
