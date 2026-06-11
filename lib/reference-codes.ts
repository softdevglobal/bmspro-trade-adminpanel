/** Human-readable reference codes stored on Firestore documents. */

export const INSPECTION_REQUEST_CODE_PREFIX = "INS-REQ";
export const QUOTATION_CODE_PREFIX = "QT";
export const INVOICE_CODE_PREFIX = "INV";
export const BOOKING_CODE_PREFIX = "BK";

/** Shared random suffix length for visit + quotation on the same request. */
export const REFERENCE_CODE_SEGMENT_LENGTH = 9;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SEGMENT_PATTERN = new RegExp(
  `^[${CODE_ALPHABET}]{${REFERENCE_CODE_SEGMENT_LENGTH}}$`,
);

function randomSegment(length: number = REFERENCE_CODE_SEGMENT_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]!;
  }
  return out;
}

export function buildInspectionRequestCodeFromSegment(segment: string): string {
  return `${INSPECTION_REQUEST_CODE_PREFIX} ${segment}`;
}

export function buildQuotationCodeFromSegment(segment: string): string {
  return `${QUOTATION_CODE_PREFIX} ${segment}`;
}

export function buildInvoiceCodeFromSegment(segment: string): string {
  return `${INVOICE_CODE_PREFIX} ${segment}`;
}

export function buildBookingCodeFromSegment(segment: string): string {
  return `${BOOKING_CODE_PREFIX} ${segment}`;
}

export function buildBookingCode(): string {
  return buildBookingCodeFromSegment(randomSegment());
}

export function buildInspectionRequestCode(): string {
  return buildInspectionRequestCodeFromSegment(randomSegment());
}

/** Normalises legacy `INS REQ` prefix to `INS-REQ` for display. */
export function normalizeInspectionRequestCodeDisplay(code: string): string {
  return code.replace(/^INS REQ /i, `${INSPECTION_REQUEST_CODE_PREFIX} `);
}

/** Pulls the 9-character suffix from a stored code (`INS-REQ …`, legacy `INS REQ …`, or `QT …`). */
export function extractReferenceSegment(
  code: string | null | undefined,
): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  const segment = trimmed.split(/\s+/).pop() ?? "";
  return SEGMENT_PATTERN.test(segment) ? segment : null;
}

/** Stable 9-char segment for older visits without `requestCode`. */
export function legacySegmentFromInspectionId(
  inspectionRequestId: string,
): string {
  const clean = inspectionRequestId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (clean.length >= REFERENCE_CODE_SEGMENT_LENGTH) {
    return clean.slice(0, REFERENCE_CODE_SEGMENT_LENGTH);
  }
  return (clean + "23456789ABC").slice(0, REFERENCE_CODE_SEGMENT_LENGTH);
}

/** Quotation uses the same 9 characters as its request. */
export function buildQuotationCodeForInspection(request: {
  id: string;
  requestCode?: string | null;
}): string {
  const segment =
    extractReferenceSegment(request.requestCode) ??
    legacySegmentFromInspectionId(request.id);
  return buildQuotationCodeFromSegment(segment);
}

/** Legacy display when older documents have no `requestCode`. */
export function legacyInspectionReferenceFromId(
  inspectionRequestId: string,
): string {
  const id = inspectionRequestId.trim();
  if (!id) return "—";
  return buildInspectionRequestCodeFromSegment(
    legacySegmentFromInspectionId(id),
  );
}

export function displayInspectionRequestCode(request: {
  id: string;
  requestCode?: string | null;
}): string {
  const code = request.requestCode?.trim();
  if (code) return normalizeInspectionRequestCodeDisplay(code);
  return legacyInspectionReferenceFromId(request.id);
}

export type InspectionRequestCodeParts = {
  prefix: string;
  segment: string | null;
};

/** Splits `INS-REQ` and the 9-char id for tighter UI spacing between them. */
export function inspectionRequestCodeParts(request: {
  id: string;
  requestCode?: string | null;
}): InspectionRequestCodeParts {
  const code = displayInspectionRequestCode(request);
  const match = code.match(/^(INS-REQ)\s+(\S+)$/i);
  if (match) {
    return { prefix: "INS-REQ", segment: match[2]! };
  }
  return { prefix: code, segment: null };
}

export function displayBookingCode(booking: {
  id: string;
  bookingCode?: string | null;
}): string {
  const code = booking.bookingCode?.trim();
  if (code) return code;
  const id = booking.id.trim();
  if (!id) return "—";
  return buildBookingCodeFromSegment(legacySegmentFromInspectionId(id));
}

export function displayQuotationCode(quotation: {
  id: string;
  quotationCode?: string | null;
  inspectionRequestId?: string;
  inspectionRequestCode?: string | null;
}): string {
  const code = quotation.quotationCode?.trim();
  if (code) return code;
  if (quotation.inspectionRequestId) {
    return buildQuotationCodeForInspection({
      id: quotation.inspectionRequestId,
      requestCode: quotation.inspectionRequestCode ?? null,
    });
  }
  const id = quotation.id.trim();
  if (!id) return "—";
  return buildQuotationCodeFromSegment(legacySegmentFromInspectionId(id));
}

/** Invoice uses the same 9 characters as its source quotation. */
export function buildInvoiceCodeForQuotation(quotation: {
  id: string;
  quotationCode?: string | null;
  inspectionRequestId?: string;
}): string {
  const segment =
    extractReferenceSegment(displayQuotationCode(quotation)) ??
    legacySegmentFromInspectionId(quotation.id);
  return buildInvoiceCodeFromSegment(segment);
}
