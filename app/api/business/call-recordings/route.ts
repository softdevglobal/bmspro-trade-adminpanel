import { fetchRecordingAudio, listCallRecordings, RecordingAccessError, RecordingTokenLimitError, recordingConfig, recordingFileForGrant } from "@/lib/ai/calls/recordings";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { z } from "zod";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

async function authorize(request: Request, operation: "list" | "play") {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const config = recordingConfig();
  if (!config) return json({ error: "Call recordings require Yeastar API credentials and a configured recording trunk." }, 503);
  const allowed = await consumeRateLimits([{
    key: "trade-call-recordings:" + operation + ":" + auth.businessId,
    limit: operation === "list" ? 30 : 10, windowMs: 60_000,
  }]);
  if (!allowed) return json({ error: "Too many recording requests. Try again in a minute." }, 429);
  return { config, businessId: auth.businessId };
}

export async function GET(request: Request) {
  try {
    const access = await authorize(request, "list");
    if (access instanceof Response) return access;
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 200) return json({ error: "Invalid recordings page." }, 400);
    const date = z.string().date().optional();
    const dates = z.object({ from: date, to: date }).safeParse({
      from: params.get("from") ?? undefined, to: params.get("to") ?? undefined,
    });
    if (!dates.success) return json({ error: "Enter valid start and end dates." }, 400);
    const { from, to } = dates.data;
    if (from && to && from > to) return json({ error: "The start date must be on or before the end date." }, 400);
    const start = from ? zonedDateTimeToUtcMs(from, "00:00") : null;
    const endMinute = to ? zonedDateTimeToUtcMs(to, "23:59") : null;
    if ((from && start === null) || (to && endMinute === null)) return json({ error: "Enter valid start and end dates." }, 400);
    const result = await listCallRecordings(access.config, access.businessId, page, {
      start: start ?? undefined, end: endMinute === null ? undefined : endMinute + 60_000,
    });
    return json({ ...result, hasMore: result.hasMore && page < 200 });
  } catch (error) {
    if (error instanceof RecordingTokenLimitError) return json({ error: "Yeastar has reached its API token limit. Try again after an existing token expires." }, 503);
    if (error instanceof RecordingAccessError) return json({ error: "Yeastar denied access to call records. Ask your administrator to check the recording API permissions." }, 502);
    return json({ error: "Could not load call recordings." }, 502);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authorize(request, "play");
    if (access instanceof Response) return access;
    const grant = request.headers.get("x-recording-grant") ?? "";
    const file = recordingFileForGrant(access.config, access.businessId, grant);
    if (!file) return json({ error: "Recording unavailable. Refresh the list and try again." }, 404);
    return await fetchRecordingAudio(access.config, file);
  } catch (error) {
    if (error instanceof RecordingTokenLimitError) return json({ error: "Yeastar has reached its API token limit. Try again after an existing token expires." }, 503);
    if (error instanceof RecordingAccessError) return json({ error: "Yeastar denied access to recording downloads. Ask your administrator to check the recording API permissions." }, 502);
    return json({ error: "Could not load this recording." }, 502);
  }
}
