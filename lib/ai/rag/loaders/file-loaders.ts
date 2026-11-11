/**
 * Reads uploaded files into plain text with LangChain document loaders.
 * Only used when an owner imports a file, never during a call.
 * After this, the text goes through the normal pipeline (ingest → chunker → embeddings).
 */
import "server-only"; // Ensures this module runs only on the server
// improts the Document type form Langchian
// A Document contains pageContent (extracted text) and metadata 
import type { Document } from "@langchain/core/documents";
// imports the supported file types from the knowledge-source definitions
import type { ImportFileType } from "../../data/knowledge-sources";
// maximum allowed upload size:25mb
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** The Content-Type the browser must send with the upload (it is part of the signed link). */
export const FILE_MIME: Record<ImportFileType, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

// Determines the file type using its extention.
// Example: "business-prices.xlsx" → "xlsx".
// Returns null if the extension is not supported.
export function fileTypeFromName(name: string): ImportFileType | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return Object.hasOwn(FILE_MIME, ext) ? (ext as ImportFileType) : null;
}

/** Checks the real content, not just the file name. */
/**
 * Validates the actual file content using its binary signature.
 *
 * WHY?
 * A user could rename malware.exe to document.pdf.
 * Checking only the extension is not sufficient.
 *
 * HOW?
 * Reads the first bytes of the file and checks their signature.
 */
export function hasExpectedSignature(type: ImportFileType, bytes: Uint8Array): boolean {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; // pptx/docx/xlsx are zip files
  if (type === "pdf") return isPdf;
  if (type === "pptx" || type === "docx" || type === "xlsx") return isZip;
  // Text files must not be binary: no NUL bytes in the first 8 KB.
  return !isPdf && !isZip && !bytes.subarray(0, 8192).includes(0);
}

/** Reads a file into plain text. `parts` is pages for PDF, sheets for Excel, rows for CSV, 1 otherwise. */
export async function extractFileText(type: ImportFileType, bytes: Uint8Array): Promise<{ text: string; parts: number }> {
  // Excel and Notepad often start text files with an invisible byte-order mark, which
  // would otherwise end up glued to the first column name.
  const content = type === "csv" || type === "txt" || type === "md" ? withoutBom(bytes) : bytes;
  // Copy into a fresh buffer so loaders that read `.buffer` never see a larger shared pool.
  const blob = new Blob([new Uint8Array(content)]);
  const { Document } = await import("@langchain/core/documents");
  let docs: Document[];
  switch (type) {
    case "pdf": {
      const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
      docs = (await new PDFLoader(blob, { splitPages: true }).load()) // one Document per page
        .map(page => new Document({ pageContent: stripPageNumbers(page.pageContent), metadata: page.metadata }));
      break;
    }
    case "pptx": {
      const { PPTXLoader } = await import("@langchain/community/document_loaders/fs/pptx");
      docs = await new PPTXLoader(blob).load(); // the whole deck's text
      break;
    }
    case "docx": {
      // LangChain's DocxLoader returns raw text, where every table cell becomes its own
      // paragraph (a price ends up far from its item). mammoth (the library DocxLoader
      // uses) can give HTML instead, which keeps tables as rows: "Item: Rice Cooker | Price: 38.33".
      const [mammoth, { htmlToText }] = await Promise.all([import("mammoth"), import("./html-text")]);
      const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(content) });
      docs = [new Document({ pageContent: await htmlToText(html) })];
      break;
    }
    case "xlsx": {
      // LangChain has no Excel loader, so we read the workbook ourselves (xlsx-reader.ts)
      // and wrap each sheet as a LangChain Document.
      const { readExcelText } = await import("./xlsx-reader");
      docs = (await readExcelText(content)).map(sheet => new Document({ pageContent: sheet.blocks.join("\n\n"), metadata: { sheet: sheet.name } }));
      break;
    }
    case "csv": {
      const { CSVLoader } = await import("@langchain/community/document_loaders/fs/csv");
      docs = await new CSVLoader(blob).load(); // one Document per row
      break;
    }
    default:
      docs = [new Document({ pageContent: new TextDecoder().decode(content) })];
  }
  // CSV: LangChain gives "column: value" on separate lines per row. Put each row on
  // one line ("a: 1 | b: 2"), one row per line, like Excel imports.
  const text = type === "csv"
    ? docs.map(doc => cleanText(doc.pageContent).split("\n").map(line => line.trim()).filter(Boolean).join(" | ")).filter(Boolean).join("\n")
    : docs.map(doc => cleanText(doc.pageContent)).filter(Boolean).join("\n\n");
  return { text, parts: docs.length };
}

function withoutBom(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
}

/** Tidies spacing. Never removes lines: a lone "90" may be a price. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Removes a page number only where page numbers live: the first or last line of a
 * PDF page ("3", "Page 3", "3 of 10", "- 3 -"). Numbers anywhere else are kept.
 */
export function stripPageNumbers(page: string): string {
  const lines = page.replace(/\r\n?/g, "\n").split("\n");
  const isPageNumber = (line: string) => /^\s*(?:page\s*)?[-–]?\s*\d{1,4}\s*[-–]?\s*(?:(?:of|\/)\s*\d{1,4})?\s*$/i.test(line);
  const firstText = lines.findIndex(line => line.trim());
  if (firstText >= 0 && isPageNumber(lines[firstText])) lines.splice(firstText, 1);
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].trim()) continue;
    if (isPageNumber(lines[index])) lines.splice(index, 1);
    break;
  }
  return lines.join("\n");
}
