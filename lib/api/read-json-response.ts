/** Parses a fetch Response as JSON; rejects HTML error pages cleanly. */
export async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response (HTTP ${res.status}).`);
  }
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      res.status === 404
        ? "API route not found. Restart the dev server and try again."
        : `Server returned an error page (HTTP ${res.status}).`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response (HTTP ${res.status}).`);
  }
}
