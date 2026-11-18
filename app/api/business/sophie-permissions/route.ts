import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";

export const runtime = "nodejs";

const permissions = z.object({
  sophieTalkEnabled: z.boolean().optional(),
  sophieLiveListenEnabled: z.boolean().optional(),
  sophieMissedCallbacksEnabled: z.boolean().optional(),
  sophieInvoiceCallsEnabled: z.boolean().optional(),
  sophieCallingHours: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdaysOnly: z.boolean(),
  }).strict().refine(hours => hours.start < hours.end, "End time must be later than start time.").optional(),
}).strict().refine(values => Object.keys(values).length > 0);

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function PATCH(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const values = permissions.safeParse(await request.json().catch(() => null));
    if (!values.success) return json({ error: "Enter valid Sophie permissions." }, 400);
    const business = adminDb.collection("businesses").doc(auth.businessId);
    const saved = await adminDb.runTransaction(async transaction => {
      const data = (await transaction.get(business)).data();
      if (!data || data.ownerUid !== auth.uid || data.isActive !== true ||
          !isTenantAccessAllowed(data.status, data.isActive)) return false;
      transaction.update(business, {
        ...values.data, sophieVoicePermissionsUpdatedAt: FieldValue.serverTimestamp(),
        ...(typeof values.data.sophieMissedCallbacksEnabled === "boolean" && {
          sophieMissedCallbacksEnabledAt: values.data.sophieMissedCallbacksEnabled ? FieldValue.serverTimestamp() : null,
        }),
      });
      return true;
    });
    return saved ? json(values.data) : json({ error: "Business owner access required." }, 403);
  } catch {
    return json({ error: "Could not save Sophie permissions." }, 500);
  }
}
