import "server-only";

import { formatAddress } from "@/lib/inspection/types";
import {
  displayInspectionRequestCode,
  displayQuotationCode,
} from "@/lib/reference-codes";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { QuotationDetail } from "@/lib/quotations/server";

const BRAND = rgb(0.043, 0.2, 0.627); // #0b33a0-ish
const TEXT = rgb(0.12, 0.16, 0.2);
const MUTED = rgb(0.39, 0.45, 0.52);
const BORDER = rgb(0.9, 0.91, 0.94);
const LIGHT = rgb(0.93, 0.96, 1);

const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

function formatDate(value: number | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const LOGO_BOX = 44;

async function embedLogoFromUrl(
  doc: PDFDocument,
  logoUrl: string,
): Promise<PDFImage | null> {
  try {
    const res = await fetch(logoUrl.trim());
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("png")) {
      return doc.embedPng(bytes);
    }
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      return doc.embedJpg(bytes);
    }
    try {
      return await doc.embedPng(bytes);
    } catch {
      return await doc.embedJpg(bytes);
    }
  } catch {
    return null;
  }
}

/** Truncates text to fit within maxWidth for the given font/size. */
function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}…`, size) > maxWidth
  ) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

/**
 * Renders a branded, single (or multi) page A4 quotation PDF and returns the
 * raw bytes.
 */
export async function generateQuotationPdf(
  quotation: QuotationDetail,
  options: {
    businessName?: string | null;
    logoUrl?: string | null;
    inspectionRequestCode?: string | null;
  } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT;

  const brandName = options.businessName?.trim() || "BMS Pro Trade";
  const logoUrl =
    options.logoUrl && /^https?:\/\//.test(options.logoUrl.trim())
      ? options.logoUrl.trim()
      : null;
  const logoImage = logoUrl ? await embedLogoFromUrl(doc, logoUrl) : null;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
  ) => {
    page.drawText(text, {
      x,
      y: yPos,
      size: opts.size ?? 11,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? TEXT,
    });
  };

  // Header band
  const headerHeight = 96;
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - headerHeight,
    width: PAGE_WIDTH,
    height: headerHeight,
    color: BRAND,
  });

  const brandTextX = logoImage ? MARGIN + LOGO_BOX + 12 : MARGIN;
  if (logoImage) {
    page.drawImage(logoImage, {
      x: MARGIN,
      y: PAGE_HEIGHT - headerHeight + (headerHeight - LOGO_BOX) / 2,
      width: LOGO_BOX,
      height: LOGO_BOX,
    });
  }

  drawText(brandName, brandTextX, PAGE_HEIGHT - 44, {
    size: 20,
    bold: true,
    color: rgb(1, 1, 1),
  });
  drawText("QUOTATION", brandTextX, PAGE_HEIGHT - 68, {
    size: 12,
    color: rgb(0.82, 0.88, 1),
  });
  const quotationRef = displayQuotationCode(quotation);
  drawText(
    quotationRef,
    PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(quotationRef, 10),
    PAGE_HEIGHT - 44,
    { size: 10, color: rgb(0.82, 0.88, 1) },
  );
  const visitRef = displayInspectionRequestCode({
    id: quotation.inspectionRequestId,
    requestCode: options.inspectionRequestCode ?? null,
  });
  const visitRefText = `Visit ${visitRef}`;
  drawText(
    visitRefText,
    PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(visitRefText, 9),
    PAGE_HEIGHT - 58,
    { size: 9, color: rgb(0.82, 0.88, 1) },
  );
  const dateText = formatDate(quotation.createdAt) || formatDate(Date.now());
  drawText(
    dateText,
    PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(dateText, 10),
    PAGE_HEIGHT - 72,
    { size: 10, color: rgb(0.82, 0.88, 1) },
  );

  y = PAGE_HEIGHT - headerHeight - 28;

  // Customer / service block
  drawText("BILLED TO", MARGIN, y, { size: 9, bold: true, color: MUTED });
  drawText("SERVICE", PAGE_WIDTH / 2, y, { size: 9, bold: true, color: MUTED });
  y -= 16;
  drawText(quotation.customer.fullName || "—", MARGIN, y, {
    size: 12,
    bold: true,
  });
  drawText(
    fitText(quotation.serviceTitle || "Quotation", font, 12, CONTENT_WIDTH / 2 - 10),
    PAGE_WIDTH / 2,
    y,
    { size: 12, bold: true },
  );
  y -= 15;
  if (quotation.customer.email) {
    drawText(quotation.customer.email, MARGIN, y, { size: 10, color: MUTED });
  }
  const addressText = formatAddress(quotation.address);
  if (addressText) {
    drawText(
      fitText(addressText, font, 10, CONTENT_WIDTH / 2 - 10),
      PAGE_WIDTH / 2,
      y,
      { size: 10, color: MUTED },
    );
  }
  y -= 14;
  if (quotation.customer.phone) {
    drawText(quotation.customer.phone, MARGIN, y, { size: 10, color: MUTED });
  }
  y -= 26;

  // Table header
  const priceColX = PAGE_WIDTH - MARGIN - 90;
  const rowHeight = 26;

  const drawTableHeader = (heading: string) => {
    ensureSpace(rowHeight + 10);
    page.drawRectangle({
      x: MARGIN,
      y: y - rowHeight + 8,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: LIGHT,
    });
    drawText(heading, MARGIN + 10, y - 8, {
      size: 9,
      bold: true,
      color: BRAND,
    });
    drawText("AMOUNT", priceColX, y - 8, {
      size: 9,
      bold: true,
      color: BRAND,
    });
    y -= rowHeight + 4;
  };

  const drawRow = (label: string, value: string, bold = false) => {
    ensureSpace(rowHeight);
    drawText(fitText(label, bold ? fontBold : font, 11, priceColX - MARGIN - 20), MARGIN + 10, y - 6, {
      size: 11,
      bold,
    });
    drawText(value, priceColX, y - 6, { size: 11, bold });
    y -= rowHeight - 4;
    page.drawLine({
      start: { x: MARGIN, y: y + 6 },
      end: { x: PAGE_WIDTH - MARGIN, y: y + 6 },
      thickness: 0.5,
      color: BORDER,
    });
    y -= 4;
  };

  drawTableHeader("LINE ITEMS");
  for (const item of quotation.lineItems) {
    drawRow(item.name, money(item.priceAud));
  }
  drawRow("Total item price", money(quotation.subtotalAud), true);

  if (quotation.additions.length > 0) {
    y -= 8;
    drawTableHeader("ADDITIONS");
    for (const addition of quotation.additions) {
      drawRow(addition.name, money(addition.priceAud));
    }
    drawRow("Additions total", money(quotation.additionsTotalAud), true);
  }

  // Final price callout
  y -= 14;
  ensureSpace(56);
  const calloutHeight = 48;
  page.drawRectangle({
    x: MARGIN,
    y: y - calloutHeight + 12,
    width: CONTENT_WIDTH,
    height: calloutHeight,
    color: BRAND,
  });
  drawText("FINAL PRICE", MARGIN + 14, y - 6, {
    size: 10,
    bold: true,
    color: rgb(0.82, 0.88, 1),
  });
  const finalText = money(quotation.finalPriceAud);
  drawText(
    finalText,
    PAGE_WIDTH - MARGIN - 14 - fontBold.widthOfTextAtSize(finalText, 18),
    y - 12,
    { size: 18, bold: true, color: rgb(1, 1, 1) },
  );
  y -= calloutHeight + 18;

  if (quotation.validUntil) {
    drawText(`Valid until: ${quotation.validUntil}`, MARGIN, y, {
      size: 10,
      color: MUTED,
    });
    y -= 18;
  }

  if (quotation.notes && quotation.notes.trim()) {
    ensureSpace(40);
    drawText("NOTES", MARGIN, y, { size: 9, bold: true, color: MUTED });
    y -= 15;
    const words = quotation.notes.trim().split(/\s+/);
    let line = "";
    const maxWidth = CONTENT_WIDTH;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, 10) > maxWidth) {
        ensureSpace(16);
        drawText(line, MARGIN, y, { size: 10, color: TEXT });
        y -= 14;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensureSpace(16);
      drawText(line, MARGIN, y, { size: 10, color: TEXT });
      y -= 14;
    }
  }

  // Footer
  drawFooter(page, font, brandName);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function drawFooter(page: PDFPage, font: PDFFont, brandName: string) {
  const text = `${brandName} · powered by BMS Pro Trade`;
  page.drawText(text, {
    x: MARGIN,
    y: 28,
    size: 9,
    font,
    color: MUTED,
  });
}
