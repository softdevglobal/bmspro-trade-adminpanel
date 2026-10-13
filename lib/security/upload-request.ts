import "server-only";

/** Limits the wire body before multipart parsing or file buffering. */
export async function boundedUploadForm(request: Request, maxFileBytes = 5 * 1024 * 1024) {
  const limit = maxFileBytes + 64 * 1024;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > limit || !request.body) throw new Error("Upload exceeds the size limit.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Upload exceeds the size limit."); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  for (const value of form.values()) if (value instanceof File && value.size > maxFileBytes) throw new Error("File exceeds the size limit.");
  return form;
}
