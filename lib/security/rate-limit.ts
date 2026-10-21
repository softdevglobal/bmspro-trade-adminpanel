import "server-only";

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

export type RateLimitPolicy = { key: string; limit: number; windowMs: number };

/** Atomic across instances. Store outages deny requests instead of bypassing limits. */
export async function consumeRateLimits(policies: RateLimitPolicy[]): Promise<boolean> {
  const now = Date.now();
  return adminDb.runTransaction(async (tx) => {
    const refs = policies.map(({ key }) => adminDb.collection("security_rate_limits")
      .doc(createHash("sha256").update(key).digest("hex")));
    const snapshots = await tx.getAll(...refs);
    const next = policies.map((policy, index) => {
      const data = snapshots[index].data();
      const active = typeof data?.until === "number" && data.until > now;
      return { count: active ? Number(data?.count ?? 0) + 1 : 1,
        until: active ? data!.until as number : now + policy.windowMs };
    });
    if (next.some((data, index) => data.count > policies[index].limit)) return false;
    next.forEach((data, index) => tx.set(refs[index], { ...data, expiresAt: Timestamp.fromMillis(data.until) }));
    return true;
  });
}

export function clientAddress(request: Request) {
  // Vercel overwrites this header at trusted ingress. Other hosts must do the same.
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown";
}
