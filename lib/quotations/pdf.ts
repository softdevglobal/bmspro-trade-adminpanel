import "server-only";

import {
  computeDocumentTotals,
  formatQuoteDate,
  formatQuoteMoney,
  formatLineDiscountLabel,
  grossSubtotalAud,
  resolveDocumentLineFromQuotationItem,
  resolveQuotationTerms,
  buildQuotationDocumentDeposit,
  formatDepositSummary,
  totalLineDiscountAud,
  type QuotationDocumentData,
  type QuotationDocumentLineItem,
} from "@/lib/quotations/document";
import type { QuotationDetail } from "@/lib/quotations/types";
import { platformTodayIso } from "@/lib/platform/timezone";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import { displayQuotationCode } from "@/lib/reference-codes";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BRAND = rgb(0.043, 0.2, 0.627);
const TEXT = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.46, 0.52);
const BORDER = rgb(0.82, 0.84, 0.88);
const ROW_ALT = rgb(0.975, 0.98, 0.99);
const TOTAL_BAR = rgb(0.1, 0.12, 0.16);
const WHITE = rgb(1, 1, 1);

const LOGO_MAX = 72;

/** StandardFonts use WinAnsi — replace common Unicode punctuation. */
function pdfSafeText(text: string): string {
  return text
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...");
}

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
) {
  return rgb(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  );
}

function drawPageDecorations(
  targetPage: PDFPage,
  fontBold: PDFFont,
  watermark = "QUOTE",
) {
  // Full-page pearl gradient — the document surface itself, not a white box on top.
  const bands = 36;
  const top = { r: 0.965, g: 0.975, b: 0.995 };
  const mid = { r: 0.98, g: 0.985, b: 0.99 };
  const bottom = { r: 0.992, g: 0.988, b: 0.982 };
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const color =
      t < 0.45
        ? lerpColor(top, mid, t / 0.45)
        : lerpColor(mid, bottom, (t - 0.45) / 0.55);
    targetPage.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - (PAGE_HEIGHT / bands) * (i + 1),
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT / bands + 1.5,
      color,
    });
  }

  // Soft corner blooms on the page surface
  targetPage.drawCircle({
    x: PAGE_WIDTH - 36,
    y: PAGE_HEIGHT - 48,
    size: 240,
    color: BRAND,
    opacity: 0.045,
  });
  targetPage.drawCircle({
    x: PAGE_WIDTH * 0.55,
    y: PAGE_HEIGHT * 0.18,
    size: 200,
    color: rgb(0.72, 0.84, 0.98),
    opacity: 0.035,
  });
  targetPage.drawCircle({
    x: 48,
    y: 72,
    size: 170,
    color: rgb(0.94, 0.9, 0.84),
    opacity: 0.05,
  });

  // Fine linen texture (sparse dots)
  for (let row = 0; row < 42; row++) {
    for (let col = 0; col < 30; col++) {
      if ((row + col) % 3 !== 0) continue;
      targetPage.drawCircle({
        x: 28 + col * 18,
        y: 28 + row * 19,
        size: 0.55,
        color: BRAND,
        opacity: 0.028,
      });
    }
  }

  // Watermark sitting on the page background
  targetPage.drawText(watermark, {
    x: PAGE_WIDTH * 0.18,
    y: PAGE_HEIGHT * 0.42,
    size: 92,
    font: fontBold,
    color: BRAND,
    opacity: 0.022,
    rotate: degrees(-18),
  });

  // Slim top accent — no side rail
  targetPage.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 3.5,
    width: PAGE_WIDTH,
    height: 3.5,
    color: BRAND,
  });

  // Inset letterhead frame
  const framePad = 10;
  targetPage.drawRectangle({
    x: MARGIN - framePad,
    y: MARGIN - framePad,
    width: CONTENT_WIDTH + framePad * 2,
    height: PAGE_HEIGHT - MARGIN * 2 + framePad * 2,
    borderColor: rgb(0.8, 0.84, 0.9),
    borderWidth: 0.6,
    opacity: 0.55,
  });
}

async function embedLogoFromUrl(
  doc: PDFDocument,
  logoUrl: string,
): Promise<PDFImage | null> {
  try {
    const res = await fetch(logoUrl.trim());
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("png")) return doc.embedPng(bytes);
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

function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const safe = pdfSafeText(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let result = safe;
  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}...`, size) > maxWidth
  ) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = pdfSafeText(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const parts = splitWordToFit(word, font, size, maxWidth);
    for (const part of parts) {
      const candidate = line ? `${line} ${part}` : part;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
        if (line) lines.push(line);
        line = part;
      } else {
        line = candidate;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function splitWordToFit(
  word: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];

  const parts: string[] = [];
  let part = "";
  for (const char of word) {
    const candidate = `${part}${char}`;
    if (part && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(part);
      part = char;
    } else {
      part = candidate;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function lineItemsFromQuotation(
  quotation: QuotationDetail,
  defaultGst: number,
): QuotationDocumentLineItem[] {
  return quotation.lineItems.map((item) =>
    resolveDocumentLineFromQuotationItem(item, defaultGst),
  );
}

export function buildQuotationDocumentFromDetail(
  quotation: QuotationDetail,
  branding: {
    businessName?: string | null;
    logoUrl?: string | null;
    businessAddress?: string | null;
    businessEmail?: string | null;
    businessPhone?: string | null;
    bookingSlug?: string | null;
    bookingPath?: string | null;
    abn?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
    timezone?: string | null;
  },
): QuotationDocumentData {
  const gstPercentage = branding.registeredForGst
    ? (branding.gstPercentage ?? 10)
    : 0;
  const lineItems = lineItemsFromQuotation(quotation, gstPercentage);
  const discountAud = quotation.discountAud ?? 0;
  const totals = computeDocumentTotals({ lineItems, discountAud });

  const quoteDate = quotation.createdAt
    ? formatQuoteDate(
        platformTodayIso(new Date(quotation.createdAt), branding.timezone),
      )
    : formatQuoteDate(platformTodayIso(new Date(), branding.timezone));

  const totalAud = quotation.finalPriceAud || totals.totalAud;

  return {
    quoteNo: displayQuotationCode(quotation),
    quoteDate,
    validUntil: quotation.validUntil,
    serviceTitle: quotation.serviceTitle?.trim()
      ? quotation.serviceTitle.trim()
      : null,
    serviceDescription: quotation.serviceDescription?.trim()
      ? quotation.serviceDescription.trim()
      : null,
    customer: quotation.customer,
    customerAddress: quotation.address,
    lineItems,
    subtotalAud: totals.subtotalAud,
    discountAud,
    gstAud: totals.gstAud,
    totalAud,
    deposit: buildQuotationDocumentDeposit(totalAud, quotation.depositRequest),
    termsAndConditions: resolveQuotationTerms(quotation),
    paymentInstructions: null,
    notes: quotation.notes?.trim() ? quotation.notes.trim() : null,
    business: {
      businessName: branding.businessName?.trim() || "Business",
      logoUrl: branding.logoUrl ?? null,
      address: branding.businessAddress ?? null,
      email: branding.businessEmail ?? null,
      phone: branding.businessPhone ?? null,
      abn: branding.abn ?? null,
      registeredForGst: Boolean(branding.registeredForGst),
      gstPercentage,
    },
  };
}

export type DocumentPdfKind = "quote" | "invoice";

/**
 * Renders a polished A4 quote or invoice PDF and returns the raw bytes.
 */
export async function generateDocumentPdf(
  data: QuotationDocumentData,
  kind: DocumentPdfKind = "quote",
): Promise<Buffer> {
  const docTitle = kind === "invoice" ? "Tax Invoice" : "Quote";
  const watermark = kind === "invoice" ? "INVOICE" : "QUOTE";
  const refLabel = kind === "invoice" ? "Invoice No:" : "Quote No:";
  const dueLabel = kind === "invoice" ? "Due date:" : "Valid until:";

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontNumeric = await doc.embedFont(StandardFonts.TimesRoman);
  const fontNumericBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawPageDecorations(page, fontBold, watermark);
  let y = PAGE_HEIGHT;
  const contentBottomY = MARGIN + 72;

  const addDecoratedPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageDecorations(page, fontBold, watermark);
    y = PAGE_HEIGHT - MARGIN;
  };

  const logoImage =
    data.business.logoUrl &&
    /^https?:\/\//.test(data.business.logoUrl.trim())
      ? await embedLogoFromUrl(doc, data.business.logoUrl)
      : null;

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
    } = {},
  ) => {
    const size = opts.size ?? 10;
    const useFont = opts.bold ? fontBold : font;
    const safe = pdfSafeText(text);
    const content = opts.maxWidth
      ? fitText(safe, useFont, size, opts.maxWidth)
      : safe;
    page.drawText(content, {
      x,
      y: yPos,
      size,
      font: useFont,
      color: opts.color ?? TEXT,
    });
  };

  const textWidth = (text: string, size: number, bold = false) =>
    (bold ? fontBold : font).widthOfTextAtSize(pdfSafeText(text), size);

  const numericWidth = (text: string, size: number, bold = false) =>
    (bold ? fontNumericBold : fontNumeric).widthOfTextAtSize(
      pdfSafeText(text),
      size,
    );

  const drawNumber = (
    text: string,
    x: number,
    yPos: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
    } = {},
  ) => {
    const size = opts.size ?? 10;
    const useFont = opts.bold ? fontNumericBold : fontNumeric;
    page.drawText(pdfSafeText(text), {
      x,
      y: yPos,
      size,
      font: useFont,
      color: opts.color ?? TEXT,
    });
  };

  const drawNumberRight = (
    text: string,
    rightX: number,
    yPos: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
    } = {},
  ) => {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    drawNumber(text, rightX - numericWidth(text, size, bold), yPos, opts);
  };

  const drawTextRight = (
    text: string,
    rightX: number,
    yPos: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
    } = {},
  ) => {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    drawText(text, rightX - textWidth(text, size, bold), yPos, opts);
  };

  const colRight = (col: { x: number; w: number }) => col.x + col.w - 6;

  const drawAbnLine = (abn: string, yPos: number) => {
    const prefix = "ABN: ";
    const size = 9;
    drawText(prefix, MARGIN, yPos, { size, color: MUTED });
    drawNumber(abn, MARGIN + textWidth(prefix, size), yPos, {
      size,
      color: MUTED,
    });
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < contentBottomY) addDecoratedPage();
  };

  // ── Header: title left, logo right ──
  y = PAGE_HEIGHT - 36;
  const headerBottom = y - 88;
  if (logoImage) {
    const scale = Math.min(
      LOGO_MAX / logoImage.width,
      LOGO_MAX / logoImage.height,
    );
    const w = logoImage.width * scale;
    const h = logoImage.height * scale;
    page.drawImage(logoImage, {
      x: PAGE_WIDTH - MARGIN - w,
      y: y - h + 6,
      width: w,
      height: h,
    });
  }

  drawText(docTitle, MARGIN, y, { size: 32, bold: true, color: BRAND });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y: y - 2 },
    end: { x: MARGIN + 52, y: y - 2 },
    thickness: 3,
    color: BRAND,
  });
  y -= 22;
  drawText(data.business.businessName, MARGIN, y, {
    size: 14,
    bold: true,
    color: TEXT,
  });
  y = Math.min(y - 28, headerBottom);

  // ── Customer card ──
  ensureSpace(72);
  const displayCustomerPhone = formatAuPhoneDisplay(data.customer.phone);
  const customerLines =
    (data.customer.fullName ? 1 : 0) +
    (data.customer.email ? 1 : 0) +
    (displayCustomerPhone ? 1 : 0);
  const cardH = Math.max(58, 28 + customerLines * 14);
  page.drawRectangle({
    x: MARGIN,
    y: y - cardH,
    width: CONTENT_WIDTH,
    height: cardH,
    color: WHITE,
    opacity: 0.88,
    borderColor: rgb(0.78, 0.84, 0.92),
    borderWidth: 0.75,
  });
  page.drawRectangle({
    x: MARGIN,
    y: y - cardH,
    width: 4,
    height: cardH,
    color: BRAND,
  });

  drawText("For:", MARGIN + 14, y - 18, { size: 8, bold: true, color: MUTED });
  let cardY = y - 32;
  if (data.customer.fullName) {
    drawText(data.customer.fullName, MARGIN + 14, cardY, {
      size: 11,
      bold: true,
    });
    cardY -= 14;
  }
  if (data.customer.email) {
    drawText(data.customer.email, MARGIN + 14, cardY, {
      size: 10,
      color: MUTED,
    });
    cardY -= 13;
  }
  if (displayCustomerPhone) {
    drawNumber(displayCustomerPhone, MARGIN + 14, cardY, {
      size: 10,
      color: MUTED,
    });
  }
  y -= cardH + 16;

  // ── Service strip ──
  if (data.serviceTitle || data.serviceDescription?.trim()) {
    const titleLines = data.serviceTitle
      ? wrapText(data.serviceTitle, fontBold, 10.5, CONTENT_WIDTH - 28)
      : [];
    const descriptionLines = data.serviceDescription?.trim()
      ? wrapText(data.serviceDescription, font, 8.5, CONTENT_WIDTH - 28)
      : [];
    const serviceH = Math.max(
      34,
      24 +
        titleLines.length * 13 +
        (descriptionLines.length > 0
          ? 4 + descriptionLines.length * 11
          : 0),
    );
    ensureSpace(serviceH + 10);
    page.drawRectangle({
      x: MARGIN,
      y: y - serviceH,
      width: CONTENT_WIDTH,
      height: serviceH,
      color: WHITE,
      opacity: 0.88,
      borderColor: rgb(0.78, 0.84, 0.92),
      borderWidth: 0.75,
    });
    page.drawRectangle({
      x: MARGIN,
      y: y - serviceH,
      width: 4,
      height: serviceH,
      color: BRAND,
    });
    drawText("Service", MARGIN + 14, y - 12, {
      size: 8,
      bold: true,
      color: MUTED,
    });
    let serviceY = y - 26;
    titleLines.forEach((line) => {
      drawText(line, MARGIN + 14, serviceY, {
        size: 10.5,
        bold: true,
      });
      serviceY -= 13;
    });
    if (descriptionLines.length > 0) {
      serviceY -= titleLines.length > 0 ? 1 : 0;
      descriptionLines.forEach((line) => {
        drawText(line, MARGIN + 14, serviceY, {
          size: 8.5,
          color: MUTED,
        });
        serviceY -= 11;
      });
    }
    y -= serviceH + 10;
  }

  // ── Quote meta bar ──
  ensureSpace(data.validUntil ? 36 : 28);
  const metaH = data.validUntil ? 30 : 22;
  page.drawRectangle({
    x: MARGIN,
    y: y - metaH,
    width: CONTENT_WIDTH,
    height: metaH,
    color: WHITE,
    opacity: 0.78,
    borderColor: rgb(0.78, 0.84, 0.92),
    borderWidth: 0.75,
  });
  page.drawRectangle({
    x: MARGIN,
    y: y - metaH,
    width: CONTENT_WIDTH,
    height: 3,
    color: BRAND,
    opacity: 0.12,
  });
  drawText(`${refLabel}  ${data.quoteNo}`, MARGIN + 10, y - 14, {
    size: 9,
    bold: true,
  });
  if (data.validUntil) {
    drawText(
      `${dueLabel}  ${formatQuoteDate(data.validUntil)}`,
      MARGIN + 10,
      y - 26,
      { size: 8.5, color: MUTED },
    );
  }
  const dateSize = 9;
  const datePrefix = "Date:  ";
  const prefixW = fontBold.widthOfTextAtSize(datePrefix, dateSize);
  const valueW = fontNumeric.widthOfTextAtSize(
    pdfSafeText(data.quoteDate),
    dateSize,
  );
  const dateX = PAGE_WIDTH - MARGIN - 10 - prefixW - valueW;
  drawText(datePrefix, dateX, y - 14, { size: dateSize, bold: true });
  drawNumber(data.quoteDate, dateX + prefixW, y - 14, { size: dateSize });
  y -= data.validUntil ? 42 : 34;

  // ── Table layout ──
  const cols = {
    code: { x: MARGIN, w: 50 },
    desc: { x: MARGIN + 50, w: 162 },
    qty: { x: MARGIN + 212, w: 40 },
    rate: { x: MARGIN + 252, w: 52 },
    disc: { x: MARGIN + 304, w: 52 },
    gst: { x: MARGIN + 356, w: 32 },
    amount: { x: MARGIN + 388, w: CONTENT_WIDTH - 388 },
  };
  const rowH = 22;

  const drawTableHeader = () => {
    ensureSpace(rowH + 8);
    page.drawRectangle({
      x: MARGIN,
      y: y - rowH + 4,
      width: CONTENT_WIDTH,
      height: rowH,
      color: WHITE,
      opacity: 0.82,
      borderColor: rgb(0.78, 0.84, 0.92),
      borderWidth: 0.75,
    });
    page.drawRectangle({
      x: MARGIN,
      y: y - rowH + 4,
      width: CONTENT_WIDTH,
      height: 2.5,
      color: BRAND,
      opacity: 0.14,
    });
    const hy = y - 13;
    drawText("Code", cols.code.x + 4, hy, { size: 7.5, bold: true, color: MUTED });
    drawText("Description", cols.desc.x + 4, hy, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    drawTextRight("Quantity", colRight(cols.qty), hy, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    drawTextRight("Rate", colRight(cols.rate), hy, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    drawTextRight("Disc.", colRight(cols.disc), hy, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    drawTextRight("GST", colRight(cols.gst), hy, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    drawTextRight("Amount", colRight(cols.amount), hy, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    y -= rowH + 2;
  };

  drawTableHeader();

  data.lineItems.forEach((item, index) => {
    ensureSpace(rowH + 4);
    if (index % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH + 4,
        width: CONTENT_WIDTH,
        height: rowH,
        color: WHITE,
        opacity: 0.72,
      });
    } else {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH + 4,
        width: CONTENT_WIDTH,
        height: rowH,
        color: ROW_ALT,
        opacity: 0.85,
      });
    }
    page.drawRectangle({
      x: MARGIN,
      y: y - rowH + 4,
      width: CONTENT_WIDTH,
      height: rowH,
      borderColor: BORDER,
      borderWidth: 0.5,
    });

    const ry = y - 13;
    const desc =
      item.description && item.description !== item.name
        ? `${item.name} - ${item.description}`
        : item.name;

    drawText(item.code ?? "-", cols.code.x + 4, ry, {
      size: 8,
      maxWidth: cols.code.w - 8,
      color: MUTED,
    });
    drawText(desc, cols.desc.x + 4, ry, {
      size: 8.5,
      maxWidth: cols.desc.w - 8,
    });
    drawNumberRight(String(item.quantity), colRight(cols.qty), ry, {
      size: 8.5,
    });
    drawNumberRight(formatQuoteMoney(item.rateAud), colRight(cols.rate), ry, {
      size: 8.5,
    });
    drawTextRight(
      formatLineDiscountLabel(item),
      colRight(cols.disc),
      ry,
      { size: 7 },
    );
    drawNumberRight(
      item.gstPercent > 0 ? `${item.gstPercent}%` : "-",
      colRight(cols.gst),
      ry,
      { size: 8.5 },
    );
    const amt = formatQuoteMoney(item.amountAud);
    drawNumberRight(amt, colRight(cols.amount), ry, {
      size: 8.5,
      bold: true,
    });
    y -= rowH;
  });

  // Parts subtotal
  y -= 6;
  ensureSpace(24);
  page.drawLine({
    start: { x: MARGIN + cols.desc.x - MARGIN, y: y + 8 },
    end: { x: PAGE_WIDTH - MARGIN, y: y + 8 },
    thickness: 1,
    color: BORDER,
  });
  const partsVal = formatQuoteMoney(data.subtotalAud);
  drawText("Subtotal", cols.desc.x, y - 4, { size: 10, bold: true });
  drawNumberRight(partsVal, PAGE_WIDTH - MARGIN, y - 4, {
    size: 10,
    bold: true,
  });
  y -= 28;

  const panelW = 240;
  const panelX = PAGE_WIDTH - MARGIN - panelW;
  const sectionGap = 14;

  const lineDiscountTotalAud = totalLineDiscountAud(data.lineItems);
  const itemsGrossSubtotalAud = grossSubtotalAud(data.lineItems);
  const hasLineDiscounts = lineDiscountTotalAud > 0.01;

  const computeTotalsPanelHeight = (): number => {
    let h = 18; // top inset
    if (hasLineDiscounts) h += 36;
    h += 18; // subtotal
    if (data.discountAud > 0) h += 18;
    if (data.gstAud > 0) h += 18;
    h += 4 + 28; // spacer + total bar
    if (data.deposit) {
      h += 18 + 12; // deposit row and due line
      if (kind === "invoice") {
        h += 16 + 28; // spacer + balance bar
      }
    }
    h += 10; // bottom padding
    return h;
  };

  const panelH = computeTotalsPanelHeight();

  const drawTotalsPanel = (panelTopY: number) => {
    page.drawRectangle({
      x: panelX,
      y: panelTopY - panelH,
      width: panelW,
      height: panelH,
      color: WHITE,
      opacity: 0.9,
      borderColor: rgb(0.78, 0.84, 0.92),
      borderWidth: 0.75,
    });

    let ty = panelTopY - 18;
    const drawPanelRow = (label: string, value: string, bold = false) => {
      drawText(label, panelX + 12, ty, { size: 9.5, bold, color: MUTED });
      drawNumberRight(value, panelX + panelW - 12, ty, { size: 9.5, bold });
      ty -= 18;
    };

    if (hasLineDiscounts) {
      drawPanelRow("Items subtotal", formatQuoteMoney(itemsGrossSubtotalAud));
      drawPanelRow(
        "Item discount",
        `-${formatQuoteMoney(lineDiscountTotalAud)}`,
      );
    }
    drawPanelRow("Subtotal", formatQuoteMoney(data.subtotalAud));
    if (data.discountAud > 0) {
      drawPanelRow("Discount", `-${formatQuoteMoney(data.discountAud)}`);
    }
    if (data.gstAud > 0) {
      const gstLabel = `GST ${data.business.gstPercentage}% (${formatQuoteMoney(data.subtotalAud - data.discountAud)})`;
      drawText(gstLabel, panelX + 12, ty, {
        size: 8.5,
        color: MUTED,
        maxWidth: panelW - 80,
      });
      drawNumberRight(formatQuoteMoney(data.gstAud), panelX + panelW - 12, ty, {
        size: 9.5,
        bold: true,
      });
      ty -= 18;
    }

    ty -= 4;
    page.drawRectangle({
      x: panelX,
      y: ty - 22,
      width: panelW,
      height: 28,
      color: TOTAL_BAR,
    });
    drawText("Total", panelX + 12, ty - 8, {
      size: 11,
      bold: true,
      color: WHITE,
    });
    drawNumberRight(formatQuoteMoney(data.totalAud), panelX + panelW - 12, ty - 9, {
      size: 12,
      bold: true,
      color: WHITE,
    });
    ty -= 30;

    if (data.deposit) {
      const depositLabel = data.deposit.paid
        ? "Deposit paid"
        : kind === "invoice"
          ? "Deposit not paid"
          : "Deposit due";

      drawText(depositLabel, panelX + 12, ty, {
        size: 9.5,
        color: MUTED,
      });
      drawNumberRight(
        data.deposit.paid
          ? `-${formatQuoteMoney(data.deposit.amountAud)}`
          : formatQuoteMoney(data.deposit.amountAud),
        panelX + panelW - 12,
        ty,
        { size: 9.5, bold: true },
      );
      ty -= 12;
      drawText(formatDepositSummary(data.deposit), panelX + 12, ty, {
        size: 7.5,
        color: MUTED,
        maxWidth: panelW - 24,
      });
      if (kind === "invoice") {
        const depositBalanceDueAud = data.deposit.paid
          ? data.deposit.balanceDueAud
          : data.totalAud;
        ty -= 16;
        page.drawRectangle({
          x: panelX,
          y: ty - 22,
          width: panelW,
          height: 28,
          color: BRAND,
        });
        drawText("Balance due", panelX + 12, ty - 8, {
          size: 11,
          bold: true,
          color: WHITE,
        });
        drawNumberRight(
          formatQuoteMoney(depositBalanceDueAud),
          panelX + panelW - 12,
          ty - 9,
          { size: 12, bold: true, color: WHITE },
        );
      }
    }
  };

  const termsText = data.termsAndConditions?.trim();
  if (termsText) {
    const termsW = CONTENT_WIDTH - panelW - sectionGap;
    const termsLines = wrapText(termsText, font, 10, termsW - 24);
    const termsLineH = 13;
    const termsHeaderH = 22;
    let remainingTermsLines = termsLines;
    let isFirstTermsPage = true;

    const drawTermsBox = (
      sectionTopY: number,
      title: string,
      lines: string[],
    ) => {
      const termsBoxH = termsHeaderH + lines.length * termsLineH;
      page.drawRectangle({
        x: MARGIN,
        y: sectionTopY - termsBoxH,
        width: termsW,
        height: termsBoxH,
        color: WHITE,
        opacity: 0.88,
        borderColor: rgb(0.78, 0.84, 0.92),
        borderWidth: 0.75,
      });
      page.drawRectangle({
        x: MARGIN,
        y: sectionTopY - termsBoxH,
        width: 4,
        height: termsBoxH,
        color: BRAND,
      });
      drawText(title, MARGIN + 12, sectionTopY - 16, {
        size: 11,
        bold: true,
        color: BRAND,
      });
      let termsY = sectionTopY - 32;
      for (const line of lines) {
        drawText(line, MARGIN + 12, termsY, {
          size: 10,
          maxWidth: termsW - 24,
        });
        termsY -= termsLineH;
      }
      return termsBoxH;
    };

    while (remainingTermsLines.length > 0) {
      if (isFirstTermsPage) {
        ensureSpace(panelH + 16);
      } else {
        addDecoratedPage();
      }

      const sectionTopY = y;
      const availableTermsH = sectionTopY - contentBottomY - 16;
      const maxTermsLines = Math.max(
        1,
        Math.floor((availableTermsH - termsHeaderH) / termsLineH),
      );
      const pageTermsLines = remainingTermsLines.slice(0, maxTermsLines);
      const termsBoxH = drawTermsBox(
        sectionTopY,
        isFirstTermsPage
          ? "Terms and conditions"
          : "Terms and conditions (continued)",
        pageTermsLines,
      );
      const sectionH = isFirstTermsPage ? Math.max(termsBoxH, panelH) : termsBoxH;

      if (isFirstTermsPage) drawTotalsPanel(sectionTopY);
      y = sectionTopY - sectionH - 20;
      remainingTermsLines = remainingTermsLines.slice(pageTermsLines.length);
      isFirstTermsPage = false;
    }
  } else {
    ensureSpace(panelH + 8);
    drawTotalsPanel(y);
    y -= panelH + 20;
  }

  if (data.notes?.trim()) {
    ensureSpace(40);
    drawText("Comments", MARGIN, y, { size: 11, bold: true, color: BRAND });
    y -= 14;
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: MARGIN + 64, y: y + 4 },
      thickness: 2,
      color: BRAND,
    });
    y -= 10;
    for (const line of wrapText(data.notes.trim(), font, 10, CONTENT_WIDTH)) {
      ensureSpace(14);
      drawText(line, MARGIN, y, { size: 10, color: MUTED });
      y -= 13;
    }
    y -= 8;
  }

  // Footer
  const footerLines: { text: string; kind: "text" | "phone" | "abn" }[] = [];
  if (data.business.address) {
    footerLines.push({ text: data.business.address, kind: "text" });
  }
  if (data.business.email) {
    footerLines.push({ text: data.business.email, kind: "text" });
  }
  if (data.business.phone) {
    footerLines.push({ text: data.business.phone, kind: "phone" });
  }
  if (data.business.abn) {
    footerLines.push({ text: data.business.abn, kind: "abn" });
  }

  const footerBlockH = footerLines.length * 12 + 20;
  let footerY = MARGIN + footerBlockH;

  page.drawLine({
    start: { x: MARGIN, y: footerY + 8 },
    end: { x: PAGE_WIDTH - MARGIN, y: footerY + 8 },
    thickness: 0.75,
    color: BORDER,
  });
  footerY -= 4;

  for (const line of footerLines) {
    if (line.kind === "abn") {
      drawAbnLine(line.text, footerY);
    } else if (line.kind === "phone") {
      drawNumber(line.text, MARGIN, footerY, { size: 9, color: MUTED });
    } else {
      drawText(line.text, MARGIN, footerY, { size: 9, color: MUTED });
    }
    footerY -= 12;
  }

  drawNumberRight("1 / 1", PAGE_WIDTH - MARGIN, MARGIN, {
    size: 9,
    color: MUTED,
  });

  return Buffer.from(await doc.save());
}

/**
 * Renders a polished A4 quotation PDF and returns the raw bytes.
 */
export async function generateQuotationPdf(
  quotation: QuotationDetail,
  options: {
    businessName?: string | null;
    logoUrl?: string | null;
    businessAddress?: string | null;
    businessEmail?: string | null;
    businessPhone?: string | null;
    bookingSlug?: string | null;
    bookingPath?: string | null;
    abn?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
    inspectionRequestCode?: string | null;
    timezone?: string | null;
  } = {},
): Promise<Buffer> {
  const data = buildQuotationDocumentFromDetail(quotation, options);
  return generateDocumentPdf(data, "quote");
}
