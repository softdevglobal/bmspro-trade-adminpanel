import { requireSuperAdmin } from "@/lib/onboarding/server";
import { listVoiceDidMappings, saveVoiceDidMapping } from "@/lib/ai/data/did-mappings";
import { DidMappingError } from "@/lib/ai/data/did-mapping-types";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try { return json({ ok: true, ...await listVoiceDidMappings() }); }
  catch { return json({ ok: false, error: "Could not load phone mappings." }, 503); }
}

export async function PUT(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  try {
    const mapping = await saveVoiceDidMapping(body, { uid: auth.uid, email: auth.email, role: "super_admin" });
    return json({ ok: true, mapping });
  } catch (error) {
    return json({ ok: false, error: error instanceof DidMappingError ? error.message : "Could not save the phone mapping." }, error instanceof DidMappingError ? error.status : 503);
  }
}
