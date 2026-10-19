import "server-only";

import { EMAIL_OUTBOX_COLLECTION } from "@/lib/email-integration/config";
import type { PlatformDocumentRef } from "@/lib/email-integration/types";
import { adminDb } from "@/lib/firebase/admin";

export type CustomerContact = { email: string; name: string };

export type BusinessMailContext = {
  /** Customer email (lowercase) -> distinct names seen for it. */
  customers: Map<string, Set<string>>;
  /** Gmail thread id -> what the platform sent in it (quote, invoice, email). */
  platformThreads: Map<string, PlatformDocumentRef>;
};

/** Collections that carry a business's customers (`customer.email` / `email`). */
const CUSTOMER_SOURCES = ["requests", "quotations", "invoices", "jobs"] as const;

function addContact(
  map: Map<string, Set<string>>,
  email: unknown,
  name: unknown,
): void {
  if (typeof email !== "string") return;
  const key = email.trim().toLowerCase();
  if (!key.includes("@")) return;
  const names = map.get(key) ?? new Set<string>();
  if (typeof name === "string" && name.trim()) names.add(name.trim());
  map.set(key, names);
}

/**
 * Everyone this business deals with on the platform, matching how the
 * Customers page builds its list, plus the threads the platform started.
 * Always scoped to one business.
 */
export async function loadBusinessMailContext(businessId: string): Promise<BusinessMailContext> {
  const customers = new Map<string, Set<string>>();

  const [registered, outbox, ...sources] = await Promise.all([
    adminDb
      .collection("customers")
      .where("registeredBusinessId", "==", businessId)
      .select("email", "fullName")
      .get(),
    adminDb
      .collection(EMAIL_OUTBOX_COLLECTION)
      .where("businessId", "==", businessId)
      .select("providerThreadId", "kind", "documentType", "documentId", "documentCode")
      .get(),
    ...CUSTOMER_SOURCES.map((collection) =>
      adminDb
        .collection(collection)
        .where("businessId", "==", businessId)
        .select("customer.email", "customer.fullName")
        .get(),
    ),
  ]);

  for (const doc of registered.docs) {
    addContact(customers, doc.get("email"), doc.get("fullName"));
  }
  for (const snap of sources) {
    for (const doc of snap.docs) {
      addContact(customers, doc.get("customer.email"), doc.get("customer.fullName"));
    }
  }

  const platformThreads = new Map<string, PlatformDocumentRef>();
  for (const doc of outbox.docs) {
    const threadId = doc.get("providerThreadId");
    if (typeof threadId !== "string" || !threadId) continue;
    const kind = doc.get("kind");
    const type = doc.get("documentType");
    const ref: PlatformDocumentRef = {
      kind: kind === "test" || kind === "message" ? kind : "document",
      type: type === "quote" || type === "invoice" ? type : null,
      id: typeof doc.get("documentId") === "string" ? doc.get("documentId") : null,
      code: typeof doc.get("documentCode") === "string" ? doc.get("documentCode") : null,
    };
    // A quote or invoice says more about the thread than a later reply does.
    const existing = platformThreads.get(threadId);
    if (!existing || (!existing.type && ref.type)) platformThreads.set(threadId, ref);
  }
  return { customers, platformThreads };
}

/** Customer contacts for the compose suggestions, sorted by name. */
export function customerContacts(context: BusinessMailContext): CustomerContact[] {
  return [...context.customers.entries()]
    .map(([email, names]) => ({ email, name: [...names][0] ?? "" }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
