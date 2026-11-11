import { audioExtension, MAX_AUDIO_BYTES, transcribeVoiceNote, VoiceDraftError } from "@/lib/ai/quotation/voice-draft";
import { setUpVoiceQuotation } from "@/lib/ai/quotation/voice-route";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/**
 * POST /api/quotations/voice-transcript (multipart form)
 *   audio      the recording (m4a, mp3, wav, webm, ogg or flac; up to 4 MB)
 *   requestId  optional site inspection the quotation is for
 *
 * Step 1 of a voice quotation: returns the transcript for the staff member to
 * read and correct. The recording is not stored.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  // Check the caller before reporting anything about the upload.
  const setup = await setUpVoiceQuotation(request, form?.get("requestId"));
  if (!setup.ok) return fail(setup.status, setup.error);
  if (!form) return fail(400, "Send the recording as a form upload.");

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, "The recording is missing.");
  if (audio.size > MAX_AUDIO_BYTES) return fail(413, "The recording is too long. Keep it under about 10 minutes.");
  const filename = audio instanceof File && audio.name ? audio.name : "recording.m4a";
  if (!audioExtension(filename)) return fail(415, "Unsupported recording format.");

  try {
    const transcript = await transcribeVoiceNote({
      config: setup.config,
      audio,
      filename,
      services: setup.services,
      items: setup.items,
    });
    return NextResponse.json({ ok: true, transcript });
  } catch (error) {
    if (error instanceof VoiceDraftError) return fail(error.status, error.message);
    console.error("[voice-quotation] transcription failed", error);
    return fail(500, "We couldn't transcribe the recording. Try again.");
  }
}
