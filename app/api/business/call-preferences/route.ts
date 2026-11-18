import { z } from "zod";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { lookupCustomerCallOptOuts, setCustomerCallOptOut } from "@/lib/ai/calls/call-preferences";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const validPhone = z.string().trim().min(6).max(24).refine(value => !!phoneComparisonKey(value), "Enter a valid phone number.");

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const input = z.object({ numbers: z.array(validPhone).max(100) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Enter valid customer numbers." }, 400);
  try {
    const states = await lookupCustomerCallOptOuts(auth.businessId, input.data.numbers);
    return json({ optedOut: input.data.numbers.map(number => states[phoneComparisonKey(number)!] === true) });
  } catch {
    return json({ error: "Could not load call preferences." }, 503);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const input = z.object({ number: validPhone, doNotCall: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Enter a valid number and call preference." }, 400);
  try {
    await setCustomerCallOptOut({ businessId: auth.businessId, phone: input.data.number,
      doNotCall: input.data.doNotCall, source: "owner", actorUid: auth.uid });
    return json({ doNotCall: input.data.doNotCall });
  } catch {
    return json({ error: "Could not save the call preference." }, 503);
  }
}
