import "server-only";

export async function requestSophieCallback(input: {
  id: string; did: string; businessId: string; number: string; automatic?: boolean;
}) {
  const url = new URL(process.env.AI_OWNER_VOICE_BRIDGE_URL ?? "");
  const secret = process.env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  if (secret.length < 32 || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Sophie callback connection is unavailable.");
  }
  url.pathname = "/sophie-callback";
  return fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(55_000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
