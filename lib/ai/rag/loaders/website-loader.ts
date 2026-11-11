/**
 * Imports one public web page as plain text.
 *
 * We fetch the page ourselves (LangChain's web loaders have no SSRF checks), refusing
 * private, local and cloud-internal addresses on every redirect hop. Mozilla
 * Readability (html-text.ts) then keeps the main text, with its lists and table rows,
 * and drops menus and footers.
 */
import "server-only";
import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { KnowledgeError } from "../../data/knowledge-sources";
import { cleanText } from "./file-loaders";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** True for any address a user-supplied URL must never reach. */
export function isPrivateAddress(raw: string): boolean {
  let ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
    if (!isIPv4(ip)) return true; // hex-form IPv4-mapped address: refuse rather than decode
  }
  if (isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)               // link-local + cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)                 // 192.0.0.0/24 special use
      || (a === 198 && (b === 18 || b === 19))  // benchmarking
      || (a === 100 && b >= 64 && b <= 127);    // carrier-grade NAT, includes Tailscale
  }
  if (!isIPv6(ip)) return true;
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")
    || /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("64:ff9b:");
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new KnowledgeError(400, "Use an http or https address.");
  if (url.username || url.password) throw new KnowledgeError(400, "Remove the user name and password from the address.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new KnowledgeError(400, "That port isn't allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIPv4(host) || isIPv6(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new KnowledgeError(400, "That website couldn't be found.");
  if (addresses.some(entry => isPrivateAddress(entry.address))) throw new KnowledgeError(400, "That address isn't allowed.");
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_HTML_BYTES) { await reader.cancel(); throw new KnowledgeError(400, "That page is too large."); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function decodeEntities(text: string) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

export async function loadWebsitePage(raw: string): Promise<{ url: string; title: string; text: string }> {
  let url = new URL(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: "manual", // check every redirect target ourselves
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "text/html", "User-Agent": "BMSProKnowledgeImport/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!next) throw new KnowledgeError(422, "The page redirected without an address.");
      url = new URL(next, url);
      continue;
    }
    if (!response.ok) throw new KnowledgeError(422, `The page answered with error ${response.status}.`);
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) throw new KnowledgeError(422, "That address isn't a web page.");

    const html = await readCapped(response);
    // Readability finds the main article; tables and lists keep their rows and lines
    // (LangChain's MozillaReadabilityTransformer returns flat text that glues them together).
    const { webPageToText } = await import("./html-text");
    const page = await webPageToText(html, url.href);
    const title = page.title || decodeEntities(/<title[^>]*>([^<]{2,200})<\/title>/i.exec(html)?.[1]?.trim() ?? "") || url.hostname;
    return { url: url.href, title: title.slice(0, 120), text: cleanText(page.text) };
  }
  throw new KnowledgeError(422, "Too many redirects.");
}
