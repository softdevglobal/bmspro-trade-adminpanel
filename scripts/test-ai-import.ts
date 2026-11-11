/**
 * Tests for AI knowledge import (LangChain loaders + website safety checks).
 * Builds small PDF / DOCX / PPTX / CSV files in memory, so no fixtures are needed.
 * Run: npm run test:ai-import
 */
import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { cleanText, extractFileText, fileTypeFromName, hasExpectedSignature, stripPageNumbers } from "../lib/ai/rag/loaders/file-loaders";
import { isPrivateAddress, loadWebsitePage } from "../lib/ai/rag/loaders/website-loader";

const utf8 = (text: string) => new TextEncoder().encode(text);

async function makePdf(pages: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) pdf.addPage([400, 200]).drawText(text, { x: 20, y: 150, size: 12, font });
  return pdf.save();
}

async function makeDocx(paragraphs: string[]) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

async function makePptx(slides: string[]) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
  slides.forEach((text, i) => zip.file(`ppt/slides/slide${i + 1}.xml`,
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`));
  return zip.generateAsync({ type: "uint8array" });
}

test("fileTypeFromName accepts supported extensions only", () => {
  assert.equal(fileTypeFromName("Price List.PDF"), "pdf");
  assert.equal(fileTypeFromName("deck.pptx"), "pptx");
  assert.equal(fileTypeFromName("terms.docx"), "docx");
  assert.equal(fileTypeFromName("rates.csv"), "csv");
  assert.equal(fileTypeFromName("notes.md"), "md");
  assert.equal(fileTypeFromName("old.doc"), null);
  assert.equal(fileTypeFromName("virus.exe"), null);
  assert.equal(fileTypeFromName("constructor"), null);
  assert.equal(fileTypeFromName("x.toString"), null);
});

test("hasExpectedSignature checks real content", async () => {
  const pdf = await makePdf(["Hello"]);
  const docx = await makeDocx(["Hello"]);
  assert.equal(hasExpectedSignature("pdf", pdf), true);
  assert.equal(hasExpectedSignature("pdf", docx), false);
  assert.equal(hasExpectedSignature("docx", docx), true);
  assert.equal(hasExpectedSignature("pptx", pdf), false);
  assert.equal(hasExpectedSignature("txt", utf8("plain text")), true);
  assert.equal(hasExpectedSignature("txt", pdf), false);
  assert.equal(hasExpectedSignature("csv", new Uint8Array([0x61, 0x00, 0x62])), false);
  assert.equal(hasExpectedSignature("pdf", new Uint8Array([0x4d, 0x5a, 0x90, 0x00])), false); // "MZ" .exe renamed to .pdf
});

test("cleanText tidies spacing but never deletes a lone number (it may be a price)", () => {
  assert.equal(cleanText("Prices\r\n\r\n\r\nCall-out   fee \n90\n"), "Prices\n\nCall-out fee\n90");
});

test("PDF page numbers are removed only at the top or bottom of a page", () => {
  assert.equal(stripPageNumbers("3\nPrices\nCall-out fee\n90\nPage 3 of 10"), "Prices\nCall-out fee\n90");
  assert.equal(stripPageNumbers("Prices\nCall-out fee\n90\n\n- 4 -\n").trim(), "Prices\nCall-out fee\n90");
  assert.equal(stripPageNumbers("Warranty months\n12\nNote"), "Warranty months\n12\nNote");
});

test("PDFLoader reads each page", async () => {
  const result = await extractFileText("pdf", await makePdf(["Call-out fee is $90.", "Quotes are free."]));
  assert.equal(result.parts, 2);
  assert.match(result.text, /Call-out fee is \$90\./);
  assert.match(result.text, /Quotes are free\./);
});

test("DocxLoader reads Word text", async () => {
  const result = await extractFileText("docx", await makeDocx(["Warranty", "12-month workmanship warranty."]));
  assert.match(result.text, /12-month workmanship warranty\./);
});

test("PPTXLoader reads slide text", async () => {
  const result = await extractFileText("pptx", await makePptx(["We service Dandenong.", "Licensed electricians."]));
  assert.match(result.text, /Dandenong/);
  assert.match(result.text, /Licensed electricians/);
});

test("CSVLoader reads one part per row", async () => {
  const result = await extractFileText("csv", utf8("service,price\nCall-out,$90\nSafety check,$150\n"));
  assert.equal(result.parts, 2);
  assert.match(result.text, /Safety check/);
});

test("plain text and markdown are read as is", async () => {
  const result = await extractFileText("md", utf8("# Hours\n\nMonday to Friday, 7am to 4pm."));
  assert.equal(result.text, "# Hours\n\nMonday to Friday, 7am to 4pm.");
});

test("isPrivateAddress blocks local, private and cloud-internal addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.88.220.83", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.63.0.1", "142.250.70.14", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("loadWebsitePage refuses unsafe addresses before fetching", async () => {
  for (const url of ["http://localhost:3001/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/",
    "http://100.88.220.83/", "http://[::1]/", "ftp://example.com/", "http://user:pass@example.com/", "http://example.com:8080/"]) {
    await assert.rejects(loadWebsitePage(url), url);
  }
});

test("MozillaReadabilityTransformer keeps main text and drops navigation", async () => {
  const { Document } = await import("@langchain/core/documents");
  const { MozillaReadabilityTransformer } = await import("@langchain/community/document_transformers/mozilla_readability");
  const html = `<html><head><title>Pricing</title></head><body><nav>Home | About | Contact</nav>
    <article><h1>Our prices</h1><p>${"We charge a $90 call-out fee within our service area. ".repeat(8)}</p>
    <p>${"Quotes are free for all jobs and we give written quotes for bigger work. ".repeat(6)}</p></article>
    <footer>Copyright 2026</footer><script>alert(1)</script></body></html>`;
  const [doc] = await new MozillaReadabilityTransformer().transformDocuments([new Document({ pageContent: html })]);
  assert.match(doc.pageContent, /\$90 call-out fee/);
  assert.doesNotMatch(doc.pageContent, /alert\(1\)/);
});

async function makeXlsx(sheets: Array<{ name: string; rows: string[][] }>) {
  const zip = new JSZip();
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  const col = (i: number) => String.fromCharCode(65 + i);
  sheets.forEach((sheet, s) => zip.file(`xl/worksheets/sheet${s + 1}.xml`,
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData>${sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`));
  return zip.generateAsync({ type: "uint8array" });
}

test("Excel .xlsx is read sheet by sheet with sheet names", async () => {
  assert.equal(fileTypeFromName("Prices 2026.XLSX"), "xlsx");
  assert.equal(fileTypeFromName("old.xls"), null);
  const bytes = await makeXlsx([
    { name: "Prices", rows: [["Service", "Price"], ["Call-out", "$90"], ["Safety check", "$150"]] },
    { name: "Areas", rows: [["Suburb"], ["Dandenong"], ["Lynbrook"]] },
  ]);
  assert.equal(hasExpectedSignature("xlsx", bytes), true);
  const result = await extractFileText("xlsx", bytes);
  assert.equal(result.parts, 2);
  assert.match(result.text, /Sheet: Prices\nService: Call-out \| Price: \$90\nService: Safety check \| Price: \$150/);
  assert.match(result.text, /Sheet: Areas\nSuburb: Dandenong\nSuburb: Lynbrook/);
});

test("Excel reader handles prefixed tags, shared strings, entities, numbers, dates and drops links", async () => {
  const { readExcelText } = await import("../lib/ai/rag/loaders/xlsx-reader");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<x:workbook xmlns:x="${ns}"><x:sheets><x:sheet name="Stock &amp; Prices" sheetId="1" r:id="Rabc" xmlns:r="${rel}"/><x:sheet name="Secret" sheetId="2" state="hidden" r:id="Rdef" xmlns:r="${rel}"/></x:sheets></x:workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="Rabc" Type="${rel}/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="Rdef" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
  zip.file("xl/sharedStrings.xml", `<x:sst xmlns:x="${ns}"><x:si><x:t>name</x:t></x:si><x:si><x:r><x:t>Fans </x:t></x:r><x:r><x:t>&amp; Appliances</x:t></x:r></x:si></x:sst>`);
  zip.file("xl/worksheets/sheet1.xml", `<x:worksheet xmlns:x="${ns}"><x:sheetData>
    <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="str"><x:v>price</x:v></x:c><x:c r="C1" t="str"><x:v>margin</x:v></x:c><x:c r="D1" t="str"><x:v>checked</x:v></x:c><x:c r="E1" t="str"><x:v>link</x:v></x:c></x:row>
    <x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2" t="n"><x:f>A1</x:f><x:v>8.8</x:v></x:c><x:c r="C2"><x:v>0.16666666666666663</x:v></x:c><x:c r="D2" t="d"><x:v>2026-11-10T00:00:00.000Z</x:v></x:c><x:c r="E2" t="str"><x:v>https://example.com/p</x:v></x:c></x:row>
    <x:row r="3"/>
  </x:sheetData></x:worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<x:worksheet xmlns:x="${ns}"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>hidden</x:v></x:c></x:row></x:sheetData></x:worksheet>`);
  const sheets = await readExcelText(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, "Stock & Prices");
  assert.equal(sheets[0].blocks[0], "Sheet: Stock & Prices\nname: Fans & Appliances | price: 8.80 | margin: 0.1667 | checked: 2026-11-10");
});

async function makeDocxTable(intro: string, rows: string[][]) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${intro}</w:t></w:r></w:p><w:tbl>${rows.map(row => `<w:tr>${row.map(cell).join("")}</w:tr>`).join("")}</w:tbl></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

test("Word tables keep each row together with its column names, and no price is lost", async () => {
  const bytes = await makeDocxTable("Our prices", [["Item", "Price"], ["Rice Cooker 1.8L", "38.33"], ["Iron Box Dry", "20"], ["Call-out fee", "90"]]);
  const { text } = await extractFileText("docx", bytes);
  assert.match(text, /^Our prices/);
  assert.match(text, /Item: Rice Cooker 1\.8L \| Price: 38\.33/);
  assert.match(text, /Item: Iron Box Dry \| Price: 20/);
  assert.match(text, /Item: Call-out fee \| Price: 90/);
});

test("web pages keep table rows, list items and paragraphs apart instead of gluing them", async () => {
  const { webPageToText, htmlToText } = await import("../lib/ai/rag/loaders/html-text");
  const intro = "<p>" + "We are a family electrical business serving the south-east suburbs with licensed electricians. ".repeat(5) + "</p>";
  const html = `<html><head><title>Prices</title></head><body><nav><a href="/">Home</a><a href="/about">About</a></nav><article><h1>Our prices</h1>${intro}<table><tr><th>Item</th><th>Price</th></tr><tr><td>Rice Cooker</td><td>$38.33</td></tr><tr><td>Call-out fee</td><td>$90</td></tr></table><ul><li>Free quotes</li><li>12 month warranty</li></ul><script>alert(1)</script></article></body></html>`;
  const page = await webPageToText(html, "https://example.com/prices");
  assert.match(page.text, /Item: Rice Cooker \| Price: \$38\.33\nItem: Call-out fee \| Price: \$90/);
  assert.match(page.text, /- Free quotes\n- 12 month warranty/);
  assert.doesNotMatch(page.text, /alert\(1\)|ItemPrice|Home ?About/);

  // A page Readability can't find an article in (a short product grid) still gives its text, minus the menu.
  const grid = `<html><body><nav>Home Shop Contact</nav><div class="grid"><div><h3>Rice Cooker</h3><span>$38.33</span></div><div><h3>Toaster</h3><span>$25</span></div></div><footer>© 2026</footer></body></html>`;
  const fallback = await webPageToText(grid, "https://example.com/shop");
  assert.match(fallback.text, /Rice Cooker\n+\$38\.33/);
  assert.match(fallback.text, /Toaster\n+\$25/);
  assert.doesNotMatch(fallback.text, /Home Shop Contact|© 2026/);

  // Tables without a header row still keep cells apart.
  assert.equal(await htmlToText("<table><tr><td>Rice Cooker</td><td>38.33</td></tr><tr><td>Toaster</td><td>25</td></tr></table>"), "Rice Cooker | 38.33\nToaster | 25");
});

test("text files drop the invisible byte-order mark Excel adds", async () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("name,price\nRice Cooker,38.33\n")]);
  const { text } = await extractFileText("csv", bom);
  assert.equal(text, "name: Rice Cooker | price: 38.33");
});

test("Excel: a title row above the header is kept as a label, and dates stored as numbers read as dates", async () => {
  const { readExcelText, excelDate, findHeaderRow } = await import("../lib/ai/rag/loaders/xlsx-reader");
  assert.equal(findHeaderRow([["Price list 2026"], ["Item", "Price", "Added"], ["Rice Cooker", "38.33", "46336"]]), 1);
  assert.equal(findHeaderRow([["Item", "Price"], ["Rice Cooker", "38.33"]]), 0);
  assert.equal(findHeaderRow([["1", "2"], ["3", "4"]]), -1);
  assert.equal(excelDate("46336"), "2026-11-10");
  assert.equal(excelDate("46336.5", true), "2026-11-10 12:00");

  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="d/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>`);
  const str = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="${ns}"><sheetData>
    <row r="1">${str("A1", "Nira Electrical price list")}</row>
    <row r="2">${str("A2", "Item")}${str("B2", "RRP (AUD)")}${str("C2", "Added")}${str("D2", "Restock")}</row>
    <row r="3">${str("A3", "Rice Cooker")}<c r="B3"><v>38.3</v></c><c r="C3" s="1"><v>46336</v></c><c r="D3" s="2"><v>46340</v></c></row>
  </sheetData></worksheet>`);
  const [sheet] = await readExcelText(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(sheet.blocks[0], "Sheet: Stock (Nira Electrical price list)\nItem: Rice Cooker | RRP (AUD): 38.30 | Added: 2026-11-10 | Restock: 2026-11-14");
});
