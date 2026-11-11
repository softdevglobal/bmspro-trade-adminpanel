/**
 * Reads an Excel .xlsx file into text Sophie can search.
 *
 * We read the file's XML ourselves (with jszip) instead of using officeparser,
 * because officeparser returns no rows for workbooks whose tags carry a namespace
 * prefix (`<x:row>`, `<x:c>`), which many exporting tools write.
 *
 * Output, per sheet, in groups of whole rows:
 *   Sheet: Electrical
 *   supplier_sku: SGPO2 | product_name: Sparkelec Double Power Point … | source_price_aud: 2.97
 * Every value carries its column name, so a passage still says what each number is,
 * and the chunker never cuts a row in half.
 */
import JSZip from "jszip";

export type ExcelSheetText = { name: string; rows: number; blocks: string[] };

const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024; // guards against zip bombs
const MAX_ROWS_PER_SHEET = 20_000;
const BLOCK_CHARS = 1400; // under the chunker's 1600 target, so a block stays together

const tag = (name: string) => `(?:[\\w.-]+:)?${name}`;

export function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const attr = (attrs: string, name: string) =>
  new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(attrs)?.[1];

/** All text runs inside a shared or inline string, skipping phonetic hints. */
function stringText(xml: string): string {
  const withoutPhonetic = xml.replace(new RegExp(`<${tag("rPh")}\\b[\\s\\S]*?</${tag("rPh")}>`, "g"), "");
  const runs = [...withoutPhonetic.matchAll(new RegExp(`<${tag("t")}\\b[^>]*>([\\s\\S]*?)</${tag("t")}>`, "g"))];
  return decodeXml(runs.map(run => run[1]).join(""));
}

function columnIndex(ref: string | undefined, fallback: number): number {
  const letters = /^([A-Z]+)/i.exec(ref ?? "")?.[1]?.toUpperCase();
  if (!letters) return fallback;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function columnLetter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Tidies a cell for speech-oriented search: no URLs, sensible numbers and dates. */
export function cleanCell(raw: string, type: string | undefined): string {
  let value = raw.replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (/^https?:\/\/\S+$/i.test(value)) return ""; // links are useless on a call and very long
  if (type === "b") return value === "1" ? "yes" : "no";
  if (type === "e") return ""; // #N/A, #REF! …
  if (type === "d" || /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z?$/.test(value)) value = value.replace(/T00:00:00(\.000)?Z?$/, "");
  if ((type === undefined || type === "n") && /^-?\d+\.\d{5,}(e[+-]?\d+)?$/i.test(value)) {
    value = String(Number(Number(value).toFixed(4)));
  }
  return value;
}

const isTextCell = (value: string) => !!value && !/^[-$€£\d.,%\s]+$/.test(value);

/** The row holding the column names: the first mostly-filled row of short text cells. -1 = none. */
export function findHeaderRow(grid: string[][]): number {
  if (grid.length < 2) return -1;
  const counts = grid.slice(0, 20).map(row => row.filter(Boolean).length);
  const widest = Math.max(...counts);
  if (widest <= 1) return isTextCell(grid[0].find(Boolean) ?? "") ? 0 : -1;
  for (let index = 0; index < Math.min(10, grid.length - 1); index++) {
    const cells = grid[index].filter(Boolean);
    if (cells.length >= Math.max(2, Math.ceil(widest * 0.5)) && cells.every(cell => isTextCell(cell) && cell.length <= 80)) return index;
  }
  return -1;
}

// Built-in Excel number formats that show a date (14–17, 27–36, 50–58) or date and time (22).
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Cell style index → "date" | "datetime" | null, from styles.xml. */
function parseDateStyles(stylesXml: string): (style: number) => "date" | "datetime" | null {
  const custom = new Map<number, string>();
  for (const match of stylesXml.matchAll(new RegExp(`<${tag("numFmt")}\\b([^>]*?)/?>`, "g"))) {
    custom.set(Number(attr(match[1], "numFmtId")), decodeXml(attr(match[1], "formatCode") ?? ""));
  }
  const cellXfs = new RegExp(`<${tag("cellXfs")}\\b[^>]*>([\\s\\S]*?)</${tag("cellXfs")}>`).exec(stylesXml)?.[1] ?? "";
  const formats = [...cellXfs.matchAll(new RegExp(`<${tag("xf")}\\b([^>]*?)/?>`, "g"))].map(match => Number(attr(match[1], "numFmtId") ?? 0));
  return style => {
    const id = formats[style];
    if (id === undefined) return null;
    if (id === 22) return "datetime";
    if (BUILT_IN_DATES.has(id)) return "date";
    const code = custom.get(id);
    if (!code) return null;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (!/[dy]/i.test(bare)) return null; // "mm:ss" or plain numbers are not dates
    return /h/i.test(bare) ? "datetime" : "date";
  };
}

/** Excel day number → "2026-11-10" (or "2026-11-10 14:30"). Leaves anything else as is. */
export function excelDate(raw: string, withTime = false): string {
  const serial = Number(raw);
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return cleanCell(raw, "n");
  const date = new Date(Math.round((serial - 25569) * 86_400_000));
  const iso = date.toISOString();
  return withTime && serial % 1 !== 0 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

export async function readExcelText(bytes: Uint8Array): Promise<ExcelSheetText[]> {
  const zip = await JSZip.loadAsync(bytes);
  let total = 0;
  zip.forEach((_, file) => {
    total += (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_UNCOMPRESSED_BYTES) throw new Error("Spreadsheet is too large once unpacked.");

  const read = async (path: string) => (await zip.file(path)?.async("string")) ?? null;
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("Not an Excel workbook.");

  // Sheet name → file path, via the workbook relationships.
  const rels = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(new RegExp(`<${tag("Relationship")}\\b([^>]*?)/?>`, "g"))) {
    const id = attr(match[1], "Id"), target = attr(match[1], "Target");
    if (!id || !target) continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const dateStyle = parseDateStyles((await read("xl/styles.xml")) ?? "");
  const sharedXml = (await read("xl/sharedStrings.xml")) ?? "";
  const shared = [...sharedXml.matchAll(new RegExp(`<${tag("si")}\\b[^>]*>([\\s\\S]*?)</${tag("si")}>`, "g"))].map(match => stringText(match[1]));

  const sheets: ExcelSheetText[] = [];
  for (const sheet of workbook.matchAll(new RegExp(`<${tag("sheet")}\\b([^>]*?)/?>`, "g"))) {
    const attrs = sheet[1];
    if (["hidden", "veryHidden"].includes(attr(attrs, "state") ?? "")) continue;
    const name = decodeXml(attr(attrs, "name") ?? "").trim() || `Sheet ${sheets.length + 1}`;
    const path = targets.get(attr(attrs, "id") ?? "");
    const xml = path ? await read(path) : null;
    if (!xml) continue;

    const grid: string[][] = [];
    for (const row of xml.matchAll(new RegExp(`<${tag("row")}\\b[^>]*>([\\s\\S]*?)</${tag("row")}>`, "g"))) {
      if (grid.length >= MAX_ROWS_PER_SHEET) break;
      const cells: string[] = [];
      let position = 0;
      for (const cell of row[1].matchAll(new RegExp(`<${tag("c")}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag("c")}>)`, "g"))) {
        const cellAttrs = cell[1], inner = cell[2] ?? "";
        const index = columnIndex(attr(cellAttrs, "r"), position);
        position = index + 1;
        const type = attr(cellAttrs, "t");
        let value: string;
        if (type === "inlineStr") value = stringText(inner);
        else {
          const v = new RegExp(`<${tag("v")}\\b[^>]*>([\\s\\S]*?)</${tag("v")}>`).exec(inner)?.[1] ?? "";
          value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
        }
        // Excel stores most dates as day numbers (46336) with a date format on the cell.
        const style = Number(attr(cellAttrs, "s") ?? -1);
        cells[index] = (type === undefined || type === "n") && dateStyle(style) ? excelDate(value, dateStyle(style) === "datetime") : cleanCell(value, type);
      }
      if (cells.some(Boolean)) grid.push(Array.from(cells, value => value ?? ""));
    }
    if (!grid.length) continue;

    // Find the header row. Sheets often start with a title row ("Price list 2026")
    // above the real column names; that title is kept on the sheet label instead.
    const headerIndex = findHeaderRow(grid);
    const first = headerIndex >= 0 ? grid[headerIndex] : [];
    const width = Math.max(...grid.map(row => row.length));
    const headers = Array.from({ length: width }, (_, index) => first[index] || `Column ${columnLetter(index)}`);
    const titles = headerIndex > 0 ? grid.slice(0, headerIndex).map(row => row.filter(Boolean).join(" ")).filter(Boolean) : [];
    const body = headerIndex >= 0 ? grid.slice(headerIndex + 1) : grid;
    // Money columns read as money: 8.8 → 8.80.
    const money = headers.map(header =>
      /(^|[^a-z])(prices?|costs?|amount|total|fees?|charges?|rrp|aud|usd|nzd|gbp|eur)([^a-z]|$)|\$/i.test(header));
    for (const row of body) row.forEach((value, index) => {
      if (money[index] && /^-?\d+(\.\d+)?$/.test(value)) row[index] = Number(value).toFixed(2);
    });

    const label = `Sheet: ${name}${titles.length ? ` (${titles.join(" · ").slice(0, 200)})` : ""}`;
    const blocks: string[] = [];
    let current: string[] = [];
    let size = label.length;
    for (const row of body) {
      const line = row.map((value, index) => (value ? `${headers[index]}: ${value}` : "")).filter(Boolean).join(" | ");
      if (!line) continue;
      if (current.length && size + line.length + 1 > BLOCK_CHARS) {
        blocks.push([label, ...current].join("\n"));
        current = [];
        size = label.length;
      }
      current.push(line);
      size += line.length + 1;
    }
    if (current.length) blocks.push([label, ...current].join("\n"));
    if (blocks.length) sheets.push({ name, rows: body.length, blocks });
  }
  return sheets;
}
