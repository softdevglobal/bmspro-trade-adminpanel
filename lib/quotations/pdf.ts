import "server-only";

import {
  computeDocumentTotals,
  formatQuoteDate,
  formatQuoteMoney,
  resolveQuotationTerms,
  type QuotationDocumentData,
  type QuotationDocumentLineItem,
} from "@/lib/quotations/document";
import type { QuotationDetail } from "@/lib/quotations/server";
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

function drawPageDecorations(targetPage: PDFPage, fontBold: PDFFont) {
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
  targetPage.drawText("QUOTE", {
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

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function lineItemsFromQuotation(
  quotation: QuotationDetail,
  defaultGst: number,
): QuotationDocumentLineItem[] {
  return quotation.lineItems.map((item) => ({
    code: item.code ?? null,
    name: item.name,
    description: item.description ?? null,
    quantity: item.quantity ?? 1,
    rateAud: item.rateAud ?? item.priceAud,
    gstPercent: item.gstPercent ?? defaultGst,
    amountAud: item.priceAud,
  }));
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
        new Date(quotation.createdAt).toISOString().slice(0, 10),
      )
    : formatQuoteDate(new Date().toISOString().slice(0, 10));

  return {
    quoteNo: displayQuotationCode(quotation),
    quoteDate,
    validUntil: quotation.validUntil,
    customer: quotation.customer,
    customerAddress: quotation.address,
    lineItems,
    subtotalAud: totals.subtotalAud,
    discountAud,
    gstAud: totals.gstAud,
    totalAud: quotation.finalPriceAud || totals.totalAud,
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
  } = {},
): Promise<Buffer> {
  const data = buildQuotationDocumentFromDetail(quotation, options);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontNumeric = await doc.embedFont(StandardFonts.TimesRoman);
  const fontNumericBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawPageDecorations(page, fontBold);
  let y = PAGE_HEIGHT;

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
    const content = opts.maxWidth
      ? fitText(text, useFont, size, opts.maxWidth)
      : text;
    page.drawText(content, {
      x,
      y: yPos,
      size,
      font: useFont,
      color: opts.color ?? TEXT,
    });
  };

  const textWidth = (text: string, size: number, bold = false) =>
    (bold ? fontBold : font).widthOfTextAtSize(text, size);

  const numericWidth = (text: string, size: number, bold = false) =>
    (bold ? fontNumericBold : fontNumeric).widthOfTextAtSize(text, size);

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
    page.drawText(text, {
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
    if (y - needed < MARGIN + 72) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawPageDecorations(page, fontBold);
      y = PAGE_HEIGHT - MARGIN;
    }
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

  drawText("Quote", MARGIN, y, { size: 32, bold: true, color: BRAND });
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
  const cardH = 58;
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

  drawText("For:", MARGIN + 14, y - 18, { size: 9, bold: true, color: MUTED });
  let cardY = y - 32;
  if (data.customer.fullName) {
    drawText(data.customer.fullName, MARGIN + 46, cardY, {
      size: 11,
      bold: true,
    });
    cardY -= 14;
  }
  if (data.customer.email) {
    drawText(data.customer.email, MARGIN + 46, cardY, {
      size: 10,
      color: MUTED,
    });
    cardY -= 13;
  }
  if (data.customer.phone) {
    drawNumber(data.customer.phone, MARGIN + 46, cardY, {
      size: 10,
      color: MUTED,
    });
  }
  y -= cardH + 16;

  // ── Quote meta bar ──
  ensureSpace(28);
  page.drawRectangle({
    x: MARGIN,
    y: y - 20,
    width: CONTENT_WIDTH,
    height: 22,
    color: WHITE,
    opacity: 0.78,
    borderColor: rgb(0.78, 0.84, 0.92),
    borderWidth: 0.75,
  });
  page.drawRectangle({
    x: MARGIN,
    y: y - 20,
    width: CONTENT_WIDTH,
    height: 3,
    color: BRAND,
    opacity: 0.12,
  });
  drawText(`Quote No:  ${data.quoteNo}`, MARGIN + 10, y - 6, {
    size: 9,
    bold: true,
  });
  const dateSize = 9;
  const datePrefix = "Date:  ";
  const prefixW = fontBold.widthOfTextAtSize(datePrefix, dateSize);
  const valueW = fontNumeric.widthOfTextAtSize(data.quoteDate, dateSize);
  const dateX = PAGE_WIDTH - MARGIN - 10 - prefixW - valueW;
  drawText(datePrefix, dateX, y - 6, { size: dateSize, bold: true });
  drawNumber(data.quoteDate, dateX + prefixW, y - 6, { size: dateSize });
  y -= 34;

  // ── Table layout ──
  const cols = {
    code: { x: MARGIN, w: 54 },
    desc: { x: MARGIN + 54, w: 198 },
    qty: { x: MARGIN + 252, w: 44 },
    rate: { x: MARGIN + 296, w: 58 },
    gst: { x: MARGIN + 354, w: 36 },
    amount: { x: MARGIN + 390, w: CONTENT_WIDTH - 390 },
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
    drawText("Quantity", cols.qty.x + 2, hy, { size: 7.5, bold: true, color: MUTED });
    drawText("Rate", cols.rate.x + 2, hy, { size: 7.5, bold: true, color: MUTED });
    drawText("GST", cols.gst.x + 2, hy, { size: 7.5, bold: true, color: MUTED });
    drawText("Amount", cols.amount.x + 2, hy, {
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
        ? `${item.name} — ${item.description}`
        : item.name;

    drawText(item.code ?? "—", cols.code.x + 4, ry, {
      size: 8,
      maxWidth: cols.code.w - 8,
      color: MUTED,
    });
    drawText(desc, cols.desc.x + 4, ry, {
      size: 8.5,
      maxWidth: cols.desc.w - 8,
    });
    drawNumber(String(item.quantity), cols.qty.x + 2, ry, { size: 8.5 });
    drawNumber(formatQuoteMoney(item.rateAud), cols.rate.x + 2, ry, {
      size: 8.5,
    });
    drawNumber(
      item.gstPercent > 0 ? `${item.gstPercent}%` : "—",
      cols.gst.x + 2,
      ry,
      { size: 8.5 },
    );
    const amt = formatQuoteMoney(item.amountAud);
    drawNumberRight(amt, cols.amount.x + cols.amount.w - 6, ry, {
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

  // Terms and conditions
  if (data.termsAndConditions?.trim()) {
    ensureSpace(48);
    const termsLines = wrapText(
      data.termsAndConditions.trim(),
      font,
      10,
      CONTENT_WIDTH - 24,
    );
    const boxH = 22 + termsLines.length * 13;
    page.drawRectangle({
      x: MARGIN,
      y: y - boxH,
      width: CONTENT_WIDTH,
      height: boxH,
      color: WHITE,
      opacity: 0.88,
      borderColor: rgb(0.78, 0.84, 0.92),
      borderWidth: 0.75,
    });
    page.drawRectangle({
      x: MARGIN,
      y: y - boxH,
      width: 4,
      height: boxH,
      color: BRAND,
    });
    drawText("Terms and conditions", MARGIN + 12, y - 16, {
      size: 11,
      bold: true,
      color: BRAND,
    });
    let ty = y - 32;
    for (const line of termsLines) {
      drawText(line, MARGIN + 12, ty, { size: 10 });
      ty -= 13;
    }
    y -= boxH + 16;
  }

  // Totals panel (right)
  const panelW = 220;
  const panelX = PAGE_WIDTH - MARGIN - panelW;
  const totalRows =
    2 +
    (data.discountAud > 0 ? 1 : 0) +
    (data.gstAud > 0 ? 1 : 0);
  const panelH = 16 + totalRows * 18 + 32;
  ensureSpace(panelH + 8);

  page.drawRectangle({
    x: panelX,
    y: y - panelH,
    width: panelW,
    height: panelH,
    color: WHITE,
    opacity: 0.9,
    borderColor: rgb(0.78, 0.84, 0.92),
    borderWidth: 0.75,
  });

  let ty = y - 18;
  const drawPanelRow = (label: string, value: string, bold = false) => {
    drawText(label, panelX + 12, ty, { size: 9.5, bold, color: MUTED });
    drawNumberRight(value, panelX + panelW - 12, ty, { size: 9.5, bold });
    ty -= 18;
  };

  drawPanelRow("Subtotal", formatQuoteMoney(data.subtotalAud));
  if (data.discountAud > 0) {
    drawPanelRow("Discount", `−${formatQuoteMoney(data.discountAud)}`);
  }
  if (data.gstAud > 0) {
    const gstLabel = `GST ${data.business.gstPercentage}% (${formatQuoteMoney(data.subtotalAud - data.discountAud)})`;
    drawText(gstLabel, panelX + 12, ty, {
      size: 8.5,
      color: MUTED,
      maxWidth: panelW - 80,
    });
    const gstVal = formatQuoteMoney(data.gstAud);
    drawNumberRight(gstVal, panelX + panelW - 12, ty, {
      size: 9.5,
      bold: true,
    });
    ty -= 18;
  }

  // Final total bar
  ty -= 4;
  page.drawRectangle({
    x: panelX,
    y: ty - 22,
    width: panelW,
    height: 28,
    color: TOTAL_BAR,
  });
  const totalLabel = "Total";
  const totalVal = formatQuoteMoney(data.totalAud);
  drawText(totalLabel, panelX + 12, ty - 8, {
    size: 11,
    bold: true,
    color: WHITE,
  });
  drawNumberRight(totalVal, panelX + panelW - 12, ty - 9, {
    size: 12,
    bold: true,
    color: WHITE,
  });
  y -= panelH + 20;

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
