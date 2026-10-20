/** Email HTML helpers shared by every mailbox provider. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Reduces HTML to readable plain text (search, quoting, plain-text view). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#")) {
        const code = entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Server-side clean-up of email HTML before it reaches the preview frame.
 * Defence in depth: the frame itself is sandboxed (no scripts) and has a CSP
 * that blocks every network request unless the user chooses to show images.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|iframe|object|embed|applet|form|noscript|template|frameset|svg|math)\b[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<\/?(script|iframe|object|embed|applet|form|input|button|textarea|select|option|link|meta|base|frame|frameset|svg|math)\b[^>]*>/gi,
      "",
    )
    .replace(/\s(on[a-z]+|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(href|src|background|action|poster|xlink:href)\s*=\s*("|')?\s*(javascript|vbscript|data:(?!image\/(png|gif|jpe?g|webp)))[^"'\s>]*("|')?/gi,
      ' $1="#"',
    );
}
