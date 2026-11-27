/** Shared by session creation and CSP so both permit the same audio endpoint. */
export function ownerAudioEndpoint(value: string | undefined, allowLoopback: boolean) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const local = allowLoopback && url.protocol === "ws:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "wss:" && !local) || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/owner-voice/audio") return null;
    return url;
  } catch { return null; }
}
