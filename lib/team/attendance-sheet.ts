import {
  formatWorkingDuration,
  type AttendanceBreakPeriod,
} from "@/lib/team/attendance";
import {
  PDFDocument,
  StandardFonts,
  type PDFPage,
  type PDFFont,
  rgb,
} from "pdf-lib";

export type AttendanceSheetRecord = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  status: string;
  workingSeconds: number;
  totalBreakSeconds: number;
  breakPeriods: AttendanceBreakPeriod[];
};

export type StaffFilterOption = {
  id: string;
  fullName: string;
  staffType: string;
};

export type AttendanceSheetDay = {
  dateKey: string;
  label: string;
  records: AttendanceSheetRecord[];
};

export type AttendanceExportRow = {
  date: string;
  dayLabel: string;
  staffName: string;
  staffRole: string;
  clockIn: string;
  clockOut: string;
  worked: string;
  breakDuration: string;
  status: string;
  breakDetail: string;
};

export type AttendanceExportMeta = {
  businessName: string;
  periodLabel: string;
  staffLabel: string;
  generatedAt: string;
};

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cloneDate(date: Date) {
  return new Date(date.getTime());
}

function startOfDay(date: Date) {
  const next = cloneDate(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function enumerateDaysInRange(start: Date, end: Date) {
  const days: Date[] = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    days.push(cloneDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function attendanceStatusLabel(status: string) {
  if (status === "checked_in") return "Active";
  if (status === "auto_checked_out") return "Auto out";
  return "Done";
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDayHeading(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function recordDayKey(checkInTime: string) {
  const date = new Date(checkInTime);
  return formatDateKey(date);
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function pdfSafeText(text: string) {
  return text
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...");
}

export function mergeStaffFilterOptions(
  roster: StaffFilterOption[],
  records: AttendanceSheetRecord[],
): StaffFilterOption[] {
  const map = new Map<string, StaffFilterOption>();
  for (const member of roster) {
    map.set(member.id, member);
  }
  for (const record of records) {
    const id = record.staffId || record.staffName;
    if (!map.has(id)) {
      map.set(id, {
        id,
        fullName: record.staffName,
        staffType: record.staffRole?.trim() || "Staff",
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export function filterRecordsByStaffIds(
  records: AttendanceSheetRecord[],
  selectedStaffIds: string[],
) {
  if (selectedStaffIds.length === 0) return records;
  const allowed = new Set(selectedStaffIds);
  return records.filter((record) => allowed.has(record.staffId || record.staffName));
}

export function buildAttendanceSheetDays(
  records: AttendanceSheetRecord[],
  rangeStart: Date,
  rangeEnd: Date,
  selectedStaffIds: string[],
): AttendanceSheetDay[] {
  const filtered = filterRecordsByStaffIds(records, selectedStaffIds);
  const days = enumerateDaysInRange(rangeStart, rangeEnd);
  const byDay = new Map<string, AttendanceSheetRecord[]>();

  for (const day of days) {
    byDay.set(formatDateKey(day), []);
  }

  for (const record of filtered) {
    const key = recordDayKey(record.checkInTime);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(record);
  }

  return days.map((day) => {
    const dateKey = formatDateKey(day);
    const dayRecords = (byDay.get(dateKey) ?? []).sort((a, b) =>
      a.staffName.localeCompare(b.staffName),
    );
    return {
      dateKey,
      label: formatDayHeading(day),
      records: dayRecords,
    };
  });
}

function formatBreakDetail(record: AttendanceSheetRecord) {
  if (!record.breakPeriods?.length) return "—";
  return record.breakPeriods
    .map((item) => {
      const start = formatTime(item.startTime);
      const end = formatTime(item.endTime);
      const duration = formatWorkingDuration(item.durationSeconds);
      return `${start}–${end} (${duration})`;
    })
    .join("; ");
}

export function buildAttendanceExportRows(
  sheetDays: AttendanceSheetDay[],
): AttendanceExportRow[] {
  const rows: AttendanceExportRow[] = [];
  for (const day of sheetDays) {
    for (const record of day.records) {
      rows.push({
        date: day.dateKey,
        dayLabel: day.label,
        staffName: record.staffName,
        staffRole: record.staffRole?.trim() || "Staff",
        clockIn: formatTime(record.checkInTime),
        clockOut: formatTime(record.checkOutTime),
        worked: formatWorkingDuration(record.workingSeconds),
        breakDuration:
          record.totalBreakSeconds > 0
            ? formatWorkingDuration(record.totalBreakSeconds)
            : "—",
        status: attendanceStatusLabel(record.status),
        breakDetail: formatBreakDetail(record),
      });
    }
  }
  return rows;
}

export function buildAttendanceCsv(
  rows: AttendanceExportRow[],
  meta: AttendanceExportMeta,
) {
  const header = [
    "Date",
    "Day",
    "Staff",
    "Role",
    "Clock in",
    "Clock out",
    "Worked",
    "Break",
    "Status",
    "Break detail",
  ];
  const lines = [
    `Business,${csvEscape(meta.businessName)}`,
    `Period,${csvEscape(meta.periodLabel)}`,
    `Staff,${csvEscape(meta.staffLabel)}`,
    `Generated,${csvEscape(meta.generatedAt)}`,
    "",
    header.map(csvEscape).join(","),
    ...rows.map((row) =>
      [
        row.date,
        row.dayLabel,
        row.staffName,
        row.staffRole,
        row.clockIn,
        row.clockOut,
        row.worked,
        row.breakDuration,
        row.status,
        row.breakDetail,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BRAND = rgb(0.043, 0.2, 0.627);
const BRAND_LIGHT = rgb(0.93, 0.96, 0.99);
const TEXT = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.46, 0.52);
const BORDER = rgb(0.82, 0.84, 0.88);
const ROW_ALT = rgb(0.975, 0.98, 0.995);
const WHITE = rgb(1, 1, 1);

type PdfColumn = {
  label: string;
  width: number;
  align?: "left" | "right";
};

const PDF_COLUMNS: PdfColumn[] = [
  { label: "Staff", width: 0.2 },
  { label: "Role", width: 0.11 },
  { label: "Clock in", width: 0.1 },
  { label: "Clock out", width: 0.1 },
  { label: "Worked", width: 0.09 },
  { label: "Break", width: 0.09 },
  { label: "Status", width: 0.1 },
  { label: "Break detail", width: 0.21 },
];

function groupExportRowsByDate(rows: AttendanceExportRow[]) {
  const groups = new Map<string, AttendanceExportRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.date) ?? [];
    bucket.push(row);
    groups.set(row.date, bucket);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function fitPdfText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
) {
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

function statusPdfColors(status: string) {
  if (status === "Active") {
    return { fill: rgb(0.9, 0.96, 1), text: BRAND };
  }
  if (status === "Auto out") {
    return { fill: rgb(0.98, 0.95, 0.9), text: rgb(0.55, 0.38, 0.12) };
  }
  return { fill: rgb(0.94, 0.96, 0.94), text: rgb(0.2, 0.45, 0.28) };
}

function drawPageBackground(targetPage: PDFPage) {
  const bands = 18;
  const top = { r: 0.965, g: 0.975, b: 0.995 };
  const bottom = { r: 0.992, g: 0.988, b: 0.982 };
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    targetPage.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - (PAGE_HEIGHT / bands) * (i + 1),
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT / bands + 1,
      color: rgb(
        top.r + (bottom.r - top.r) * t,
        top.g + (bottom.g - top.g) * t,
        top.b + (bottom.b - top.b) * t,
      ),
    });
  }

  targetPage.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 4,
    width: PAGE_WIDTH,
    height: 4,
    color: BRAND,
  });

  targetPage.drawCircle({
    x: PAGE_WIDTH - 48,
    y: PAGE_HEIGHT - 56,
    size: 180,
    color: BRAND,
    opacity: 0.04,
  });
}

function drawPageFooter(
  targetPage: PDFPage,
  font: PDFFont,
  pageNumber: number,
  pageCount: number,
  businessName: string,
) {
  const footerY = 24;
  targetPage.drawLine({
    start: { x: MARGIN, y: footerY + 14 },
    end: { x: PAGE_WIDTH - MARGIN, y: footerY + 14 },
    thickness: 0.6,
    color: BORDER,
  });
  targetPage.drawText(pdfSafeText(businessName), {
    x: MARGIN,
    y: footerY,
    size: 8,
    font,
    color: MUTED,
  });
  targetPage.drawText("Attendance report", {
    x: PAGE_WIDTH / 2 - 42,
    y: footerY,
    size: 8,
    font,
    color: MUTED,
  });
  targetPage.drawText(`Page ${pageNumber} of ${pageCount}`, {
    x: PAGE_WIDTH - MARGIN - 58,
    y: footerY,
    size: 8,
    font,
    color: MUTED,
  });
}

export async function generateAttendancePdf(
  rows: AttendanceExportRow[],
  meta: AttendanceExportMeta,
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const groupedRows = groupExportRowsByDate(rows);
  const uniqueStaff = new Set(rows.map((row) => row.staffName)).size;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function drawTextAt(
    text: string,
    x: number,
    textY: number,
    size: number,
    bold = false,
    color = TEXT,
  ) {
    page.drawText(pdfSafeText(text), {
      x,
      y: textY,
      size,
      font: bold ? fontBold : font,
      color,
    });
  }

  function startPage(withTableHeader = false) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    drawPageBackground(page);
    y = PAGE_HEIGHT - MARGIN;
    if (withTableHeader) {
      drawTableColumnHeader();
    }
  }

  function ensureSpace(needed: number) {
    if (y - needed < 52) {
      startPage(true);
    }
  }

  function drawMetaCard(
    x: number,
    cardTop: number,
    width: number,
    label: string,
    value: string,
  ) {
    const cardHeight = 42;
    page.drawRectangle({
      x,
      y: cardTop - cardHeight,
      width,
      height: cardHeight,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    page.drawRectangle({
      x,
      y: cardTop - 3,
      width,
      height: 3,
      color: BRAND,
      opacity: 0.85,
    });
    drawTextAt(label.toUpperCase(), x + 10, cardTop - 14, 7, true, MUTED);
    drawTextAt(
      fitPdfText(value, fontBold, 9.5, width - 20),
      x + 10,
      cardTop - 30,
      9.5,
      true,
      TEXT,
    );
  }

  function drawReportHeader() {
    const headerHeight = 118;
    const headerTop = y;
    const headerBottom = headerTop - headerHeight;

    page.drawRectangle({
      x: MARGIN,
      y: headerBottom,
      width: CONTENT_WIDTH,
      height: headerHeight,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: MARGIN,
      y: headerTop - 5,
      width: CONTENT_WIDTH,
      height: 5,
      color: BRAND,
    });

    drawTextAt(meta.businessName, MARGIN + 18, headerTop - 28, 20, true, TEXT);
    drawTextAt("Attendance report", MARGIN + 18, headerTop - 50, 13, true, BRAND);

    const generatedLabel = `Generated ${meta.generatedAt}`;
    const generatedWidth =
      font.widthOfTextAtSize(pdfSafeText(generatedLabel), 8.5) + 20;
    page.drawRectangle({
      x: PAGE_WIDTH - MARGIN - generatedWidth - 18,
      y: headerTop - 40,
      width: generatedWidth,
      height: 22,
      color: BRAND_LIGHT,
      borderColor: rgb(0.78, 0.86, 0.96),
      borderWidth: 0.5,
    });
    drawTextAt(
      generatedLabel,
      PAGE_WIDTH - MARGIN - generatedWidth - 8,
      headerTop - 32,
      8.5,
      false,
      BRAND,
    );

    const cardTop = headerBottom + 48;
    const gap = 10;
    const cardWidth = (CONTENT_WIDTH - 36 - gap * 2) / 3;
    const cardX1 = MARGIN + 18;
    drawMetaCard(cardX1, cardTop, cardWidth, "Period", meta.periodLabel);
    drawMetaCard(
      cardX1 + cardWidth + gap,
      cardTop,
      cardWidth,
      "Staff filter",
      meta.staffLabel,
    );
    drawMetaCard(
      cardX1 + (cardWidth + gap) * 2,
      cardTop,
      cardWidth,
      "Summary",
      `${rows.length} shift${rows.length === 1 ? "" : "s"} · ${uniqueStaff} staff`,
    );

    y = headerBottom - 16;
  }

  function drawTableColumnHeader() {
    const headerHeight = 24;
    ensureSpace(headerHeight + 4);
    let x = MARGIN;
    for (const column of PDF_COLUMNS) {
      const width = CONTENT_WIDTH * column.width;
      page.drawRectangle({
        x,
        y: y - headerHeight,
        width,
        height: headerHeight,
        color: BRAND,
      });
      page.drawText(pdfSafeText(column.label.toUpperCase()), {
        x: x + 8,
        y: y - headerHeight + 8,
        size: 7.5,
        font: fontBold,
        color: WHITE,
      });
      x += width;
    }
    y -= headerHeight + 6;
  }

  function drawDaySectionHeader(dayLabel: string, shiftCount: number) {
    const sectionHeight = 22;
    ensureSpace(sectionHeight + 4);
    page.drawRectangle({
      x: MARGIN,
      y: y - sectionHeight,
      width: CONTENT_WIDTH,
      height: sectionHeight,
      color: BRAND_LIGHT,
      borderColor: rgb(0.78, 0.86, 0.96),
      borderWidth: 0.5,
    });
    drawTextAt(dayLabel, MARGIN + 10, y - 15, 9, true, BRAND);
    const summary = `${shiftCount} shift${shiftCount === 1 ? "" : "s"}`;
    const summaryWidth = font.widthOfTextAtSize(pdfSafeText(summary), 8.5);
    drawTextAt(
      summary,
      PAGE_WIDTH - MARGIN - summaryWidth - 10,
      y - 15,
      8.5,
      false,
      MUTED,
    );
    y -= sectionHeight + 4;
  }

  function drawDataRow(row: AttendanceExportRow, rowIndex: number) {
    const rowHeight = 24;
    ensureSpace(rowHeight + 2);
    const fill = rowIndex % 2 === 0 ? WHITE : ROW_ALT;

    page.drawRectangle({
      x: MARGIN,
      y: y - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: fill,
      borderColor: BORDER,
      borderWidth: 0.35,
    });

    let x = MARGIN;
    const values = [
      row.staffName,
      row.staffRole,
      row.clockIn,
      row.clockOut,
      row.worked,
      row.breakDuration,
      row.status,
      row.breakDetail,
    ];

    for (let index = 0; index < PDF_COLUMNS.length; index += 1) {
      const column = PDF_COLUMNS[index]!;
      const width = CONTENT_WIDTH * column.width;
      const rawValue = values[index] ?? "";
      const isStatus = column.label === "Status";
      const isDash = rawValue === "—";

      if (isStatus) {
        const colors = statusPdfColors(rawValue);
        const badgeText = pdfSafeText(rawValue);
        const badgeWidth = fontBold.widthOfTextAtSize(badgeText, 7) + 12;
        page.drawRectangle({
          x: x + 6,
          y: y - rowHeight + 7,
          width: Math.min(badgeWidth, width - 8),
          height: 12,
          color: colors.fill,
          borderColor: colors.text,
          borderWidth: 0.4,
        });
        page.drawText(badgeText, {
          x: x + 10,
          y: y - rowHeight + 10,
          size: 7,
          font: fontBold,
          color: colors.text,
        });
      } else {
        page.drawText(
          fitPdfText(isDash ? "—" : rawValue, font, 8.5, width - 12),
          {
            x: x + 8,
            y: y - rowHeight + 9,
            size: 8.5,
            font,
            color: isDash ? MUTED : TEXT,
          },
        );
      }
      x += width;
    }
    y -= rowHeight;
  }

  startPage(false);
  drawReportHeader();
  drawTableColumnHeader();

  if (rows.length === 0) {
    page.drawRectangle({
      x: MARGIN,
      y: y - 56,
      width: CONTENT_WIDTH,
      height: 56,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    drawTextAt(
      "No attendance records for this period.",
      MARGIN + 16,
      y - 34,
      10,
      false,
      MUTED,
    );
    y -= 72;
  } else {
    for (const [, dayRows] of groupedRows) {
      drawDaySectionHeader(dayRows[0]?.dayLabel ?? "", dayRows.length);
      dayRows.forEach((row, index) => drawDataRow(row, index));
      y -= 6;
    }
  }

  const pageCount = pages.length;
  pages.forEach((targetPage, index) => {
    drawPageFooter(
      targetPage,
      font,
      index + 1,
      pageCount,
      meta.businessName,
    );
  });

  return doc.save();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportAttendanceCsv(
  rows: AttendanceExportRow[],
  meta: AttendanceExportMeta,
  filename: string,
) {
  const csv = buildAttendanceCsv(rows, meta);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename);
}

export async function exportAttendancePdf(
  rows: AttendanceExportRow[],
  meta: AttendanceExportMeta,
  filename: string,
) {
  const bytes = await generateAttendancePdf(rows, meta);
  const blob = new Blob([Uint8Array.from(bytes)], {
    type: "application/pdf",
  });
  downloadBlob(blob, filename);
}
