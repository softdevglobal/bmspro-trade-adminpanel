/**
 * POST { url, title? } — imports ONE public web page as a draft knowledge entry.
 * The page is fetched with SSRF checks (lib/ai/rag/loaders/website-loader.ts),
 * then LangChain Readability keeps only the main text.
 */
import { after } from "next/server";
import { z } from "zod";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KnowledgeError } from "@/lib/ai/data/knowledge-sources";
import { loadWebsitePage } from "@/lib/ai/rag/loaders/website-loader";
import { allowImport, createImportedSource, indexInBackground } from "@/lib/ai/rag/import-source";
import { KNOWLEDGE_PURPOSES, PURPOSE_NOTE_MAX, purposeError } from "@/lib/ai/data/knowledge-purpose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const urlRequest = z.object({
  url: z.string().trim().url().max(2000),
  title: z.string().trim().min(2).max(120).optional(),
  purpose: z.enum(KNOWLEDGE_PURPOSES),
  purposeNote: z.string().trim().max(PURPOSE_NOTE_MAX).optional(),
}).strict();

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const parsed = urlRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "Enter a full web address (e.g. https://example.com.au/pricing) and choose what the page is." }, 400);
  const invalidPurpose = purposeError(parsed.data.purpose, parsed.data.purposeNote ?? "");
  if (invalidPurpose) return json({ ok: false, error: invalidPurpose }, 400);

  try {
    if (!await allowImport(auth.businessId)) return json({ ok: false, error: "Too many imports. Try again in an hour." }, 429);
    const page = await loadWebsitePage(parsed.data.url);
    const saved = await createImportedSource(auth, {
      kind: "website", title: parsed.data.title ?? page.title, text: page.text, origin: { type: "url", url: page.url },
      purpose: parsed.data.purpose, purposeNote: parsed.data.purposeNote,
    });
    after(() => indexInBackground(saved.id, "import-url"));
    return json({ ok: true, ...saved }, 201);
  } catch (error) {
    return error instanceof KnowledgeError
      ? json({ ok: false, error: error.message }, error.status)
      : json({ ok: false, error: "Could not read that page." }, 422);
  }
}
