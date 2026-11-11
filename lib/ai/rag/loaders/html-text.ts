/**
 * Turns HTML (a web page, or a Word document converted by mammoth) into text that
 * keeps its structure, so nothing gets glued together or separated from its label:
 *
 *   paragraphs and headings → separated by a blank line
 *   list items              → "- item", one per line
 *   table rows              → one line per row, with the column names:
 *                             "Item: Rice Cooker | Price: $38.33"
 *
 * Plain `textContent` loses all of this ("ItemPriceRice Cooker$38.33…").
 * jsdom never runs the page's scripts or loads its resources by default.
 */
import "server-only";

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "canvas", "button", "select", "input", "textarea"]);
const PARAGRAPH = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "ul", "ol", "dl", "section", "article", "header", "footer", "main", "figure"]);
const LINE = new Set(["div", "li", "dt", "dd", "tr", "figcaption", "address", "caption", "hr"]);
// Page chrome dropped when we fall back to the whole page.
const CHROME = "nav, header, footer, aside, form, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]";

type DomNode = { nodeType: number; textContent: string | null; childNodes: ArrayLike<DomNode> };
type DomElement = DomNode & { tagName: string; children: ArrayLike<DomElement>; getAttribute(name: string): string | null };

// Break markers while walking; turned into "\n" or "\n\n" at the end.
const LINE_BREAK = "\u0001";
const PARAGRAPH_BREAK = "\u0002";
const squash = (text: string) => text.replace(/[\s\u0001\u0002]+/g, " ").trim();

function tableToLines(table: DomElement): string[] {
  const rows: string[][] = [];
  const collect = (element: DomElement) => {
    for (const child of Array.from(element.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "tr") rows.push(Array.from(child.children).filter(cell => /^(td|th)$/i.test(cell.tagName)).map(cell => squash(nodeText(cell))));
      else if (tag !== "table") collect(child); // thead / tbody / tfoot, but not nested tables
    }
  };
  collect(table);
  const filled = rows.filter(row => row.some(Boolean));
  if (!filled.length) return [];
  const width = Math.max(...filled.map(row => row.length));
  // A first row of short text cells is a header; each later row then carries the names.
  const first = filled[0];
  const hasHeader = filled.length > 1 && width > 1 && first.filter(Boolean).length >= Math.min(2, width)
    && first.every(cell => cell.length <= 60 && !/^[-$€£\d.,%\s]+$/.test(cell));
  if (!hasHeader) return filled.map(row => row.filter(Boolean).join(" | "));
  return filled.slice(1).map(row => row.map((cell, index) => (cell ? (first[index] ? `${first[index]}: ${cell}` : cell) : "")).filter(Boolean).join(" | ")).filter(Boolean);
}

function nodeText(root: DomNode): string {
  const out: string[] = [];
  const walk = (node: DomNode) => {
    if (node.nodeType === 3) { out.push((node.textContent ?? "").replace(/\s+/g, " ")); return; }
    if (node.nodeType !== 1) return;
    const element = node as DomElement;
    const tag = element.tagName.toLowerCase();
    if (SKIP.has(tag) || element.getAttribute("hidden") !== null) return;
    if (tag === "br") { out.push(LINE_BREAK); return; }
    if (tag === "img") { const alt = squash(element.getAttribute("alt") ?? ""); if (alt) out.push(` ${alt} `); return; }
    if (tag === "table") { out.push(PARAGRAPH_BREAK, tableToLines(element).join(LINE_BREAK), PARAGRAPH_BREAK); return; }
    if (tag === "td" || tag === "th") { out.push(" "); Array.from(element.childNodes).forEach(walk); out.push(" | "); return; }
    const gap = PARAGRAPH.has(tag) ? PARAGRAPH_BREAK : LINE.has(tag) ? LINE_BREAK : "";
    out.push(gap);
    if (tag === "li") out.push("- ");
    if (/^h[1-6]$/.test(tag)) out.push(`${"#".repeat(Number(tag[1]))} `);
    Array.from(element.childNodes).forEach(walk);
    out.push(gap);
  };
  // Walk the contents, not the root itself, so a table cell's text has no cell markers.
  Array.from(root.childNodes).forEach(walk);
  // Neighbouring elements each add a break; a run of breaks is one blank line if any
  // of them was a paragraph break, otherwise a single new line (list items, rows).
  return out.join("").replace(/[\u0001\u0002]+/g, run => (run.includes(PARAGRAPH_BREAK) ? "\n\n" : "\n"));
}

export function tidyText(text: string): string {
  return text
    .split("\n").map(line => line.replace(/[ \t]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim()).join("\n")
    .replace(/^#{1,6}\s*$/gm, "")
    .replace(/^-\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML fragment or document → structured text. */
export async function htmlToText(html: string): Promise<string> {
  const { JSDOM } = await import("jsdom");
  const { document } = new JSDOM(html).window;
  return tidyText(nodeText(document.body as unknown as DomNode));
}

/**
 * A web page → its main text. Uses Mozilla Readability to find the article; when that
 * finds little (home pages, product grids), falls back to the whole page minus menus
 * and footers, so a page with real content never comes back empty.
 */
export async function webPageToText(html: string, url: string): Promise<{ title: string; text: string }> {
  const [{ JSDOM }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const pageTitle = squash(document.title ?? "");
  // Readability changes the document it reads, so give it a copy.
  const article = new Readability(new JSDOM(html, { url }).window.document).parse();
  const articleText = article?.content ? await htmlToText(article.content) : "";
  if (articleText.length >= 400) return { title: squash(article?.title ?? "") || pageTitle, text: articleText };
  document.querySelectorAll(CHROME).forEach(element => element.remove());
  const pageText = tidyText(nodeText(document.body as unknown as DomNode));
  // Prefer the whole page without menus; Readability's short guess can include them.
  return { title: pageTitle, text: pageText.length >= 20 || pageText.length >= articleText.length ? pageText : articleText };
}
