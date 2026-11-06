export type TextChunk = { ordinal: number; text: string };

const TARGET_CHARS = 1600; // ≈ 400 tokens
const MAX_CHARS = 2400;    // ≈ 600 tokens
const MIN_LAST_CHARS = 200;

/**
 * Splits a source into topic-sized chunks. Each chunk starts with the source
 * title, so a passage like "Yes, $90" still embeds and reads with its topic.
 */
export function chunkText(title: string, body: string): TextChunk[] {
  const normalized = body.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  // 1. Paragraphs and markdown headings are natural topic boundaries.
  const blocks = normalized.split(/\n{2,}|\n(?=#{1,6}\s)/).map(block => block.trim()).filter(Boolean);

  // 2. Break any very long block on sentence boundaries.
  const pieces: string[] = [];
  for (const block of blocks) {
    if (block.length <= MAX_CHARS) { pieces.push(block); continue; }
    let current = "";
    for (const sentence of block.split(/(?<=[.!?])\s+/)) {
      if (current && current.length + sentence.length + 1 > TARGET_CHARS) { pieces.push(current); current = ""; }
      current = current ? `${current} ${sentence}` : sentence;
      while (current.length > MAX_CHARS) { pieces.push(current.slice(0, MAX_CHARS)); current = current.slice(MAX_CHARS); }
    }
    if (current) pieces.push(current);
  }

  // 3. Pack pieces up to the target size.
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > TARGET_CHARS) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);

  // 4. Merge a tiny trailing chunk into the previous one.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_LAST_CHARS) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1] += `\n\n${last}`;
  }

  return chunks.map((text, ordinal) => ({ ordinal, text: `${title.trim()}\n${text}` }));
}
