// shape of one output chunk: its position in the sequence and its text
export type TextChunk = { ordinal: number; text: string };
// Ideal chunk size in characters for ordinary text
const TARGET_CHARS = 1600; // ≈ 400 tokens
// Hard upper limit for a single piece
const MAX_CHARS = 2400;    // ≈ 600 tokens
// If the last chunk is shorter than this it gets merged into the previous one
const MIN_LAST_CHARS = 200;
// Lists and tables split much smaller: a piece holding 10+ items matches any one of
// them weakly ("rice cooker" among 10 products); 2–4 rows match closely.
const LIST_TARGET_CHARS = 450;
const LIST_MAX_ROWS = 4;

/** Cuts at the last space before `max` so a word is never split. */
function cutAtWord(text: string, max: number): [string, string] {
  if (text.length <= max) return [text, ""];
  const space = text.lastIndexOf(" ", max);
  const at = space > max * 0.6 ? space : max;
  return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()];
}

/** Rows like "Rice Cooker 1.8L 38.33", "Item: X | Price: 9", "- Free quotes", "Q: …". */
const ROW_LIKE = /\d|\$|\||\t|^[-•*·]\s|:\s/;

/**
 * A block is a list when it has several short lines that mostly look like rows or
 * items. Wrapped prose (a PDF paragraph broken at the page width) has long lines
 * with few numbers, so it stays ordinary text.
 */
export function isListBlock(lines: string[]): boolean {
  if (lines.length < 4) return false;
  const lengths = lines.map(line => line.length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  const rowLike = lines.filter(line => ROW_LIKE.test(line)).length;
  return median <= 200 && rowLike >= lines.length * 0.6;
}

/** A short line that names what follows: "## Prices", "Sheet: Electrical", "Our rates:". */
const isLabel = (line: string) => line.length <= 100 && (/^#{1,6}\s/.test(line) || /^Sheet: /.test(line) || /:$/.test(line));

/** Groups whole lines into small pieces, repeating the label on each. */
function groupLines(lines: string[], label: string, target: number): string[] {
  const pieces: string[] = [];
  let current: string[] = [];
  let size = label.length;
  const flush = () => {
    if (current.length) pieces.push([label, ...current].filter(Boolean).join("\n"));
    current = [];
    size = label.length;
  };
  for (const raw of lines) {
    let rest = raw;
    while (rest) {
      const [line, remainder] = cutAtWord(rest, MAX_CHARS);
      rest = remainder;
      if (current.length && (size + line.length + 1 > target || current.length >= LIST_MAX_ROWS)) flush();
      current.push(line);
      size += line.length + 1;
    }
  }
  flush();
  return pieces;
}

/** Splits an over-long block at line breaks, then sentences, then words — never mid-word. */
function splitLongBlock(block: string): string[] {
  const pieces: string[] = [];
  let current = "";
  const add = (part: string, joiner: string) => {
    if (current && current.length + part.length + joiner.length > TARGET_CHARS) { pieces.push(current); current = ""; }
    current = current ? `${current}${joiner}${part}` : part;
    while (current.length > MAX_CHARS) {
      const [head, tail] = cutAtWord(current, TARGET_CHARS);
      pieces.push(head);
      current = tail;
    }
  };
  for (const line of block.split("\n")) {
    if (line.length <= TARGET_CHARS) { add(line, "\n"); continue; }
    for (const sentence of line.split(/(?<=[.!?])\s+/)) add(sentence, " ");
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Splits a source into topic-sized chunks. Each chunk starts with the source
 * title, so a passage like "Yes, $90" still embeds and reads with its topic.
 * Lists and tables become small pieces of whole rows, so one item is easy to find.
 */
export function chunkText(title: string, body: string): TextChunk[] {
  const normalized = body.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return []; // if nothing is left after cleaning there is nothing to chunk

  // 1. Paragraphs and markdown headings are natural topic boundaries.
  const blocks = normalized.split(/\n{2,}|\n(?=#{1,6}\s)/).map(block => block.trim()).filter(Boolean);

  const chunks: { text: string; list: boolean }[] = [];
  let prose: string[] = []; // ordinary pieces waiting to be packed together
  const flushProse = () => {
    let current = "";
    for (const piece of prose) {
      if (current && current.length + piece.length + 2 > TARGET_CHARS) { chunks.push({ text: current, list: false }); current = ""; }
      current = current ? `${current}\n\n${piece}` : piece;
    }
    if (current) chunks.push({ text: current, list: false });
    prose = [];
  };

  for (const block of blocks) {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    // A label line at the top of the block ("## Prices") belongs to the list under it.
    let label = lines.length > 1 && isLabel(lines[0]) ? lines[0] : "";
    const rows = label ? lines.slice(1) : lines;
    if (isListBlock(rows)) {
      // A short heading paragraph just before the list also labels it.
      const previous = prose.at(-1);
      if (!label && previous && !previous.includes("\n") && previous.length <= 100) label = prose.pop()!;
      flushProse();
      for (const text of groupLines(rows, label, LIST_TARGET_CHARS)) chunks.push({ text, list: true });
      continue;
    }
    // 2. Break any very long block at lines, then sentences, then words.
    if (block.length <= MAX_CHARS) prose.push(block);
    else prose.push(...splitLongBlock(block));
  }
  flushProse();

  // 3. Merge a tiny trailing text chunk into the previous text chunk.
  const last = chunks.at(-1), before = chunks.at(-2);
  if (last && before && !last.list && !before.list && last.text.length < MIN_LAST_CHARS) {
    chunks.pop();
    before.text += `\n\n${last.text}`;
  }

  // prefix every chunk with the trimmed title
  // and attach its index (ordinal) in the sequence
  return chunks.map((chunk, ordinal) => ({ ordinal, text: `${title.trim()}\n${chunk.text}` }));
}

/**
 * Spreadsheet text (one row per line, from Excel or CSV) splits into small pieces of
 * a few whole rows. A leading "Sheet: …" line is repeated on every piece from that sheet.
 */
export function chunkTableText(title: string, body: string, targetChars = LIST_TARGET_CHARS): TextChunk[] {
  const blocks = body.replace(/\r\n?/g, "\n").split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    const label = /^Sheet: /.test(lines[0] ?? "") ? lines.shift()! : "";
    chunks.push(...groupLines(lines, label, targetChars));
  }
  return chunks.map((text, ordinal) => ({ ordinal, text: `${title.trim()}\n${text}` }));
}
