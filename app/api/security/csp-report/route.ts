import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Browsers send small JSON bodies; anything larger is noise or abuse. */
const MAX_BODY_BYTES = 16 * 1024;

type CspReportBody = {
  "csp-report"?: Record<string, unknown>;
};

function summarize(report: Record<string, unknown>): string {
  const directive =
    report["effective-directive"] ?? report["violated-directive"] ?? "unknown";
  const blocked = report["blocked-uri"] ?? "unknown";
  const document = report["document-uri"] ?? "unknown";
  return `${String(directive)} blocked ${String(blocked)} on ${String(document)}`;
}

/**
 * Collection point for `report-uri` violations emitted while the CSP in
 * next.config.ts runs in report-only mode. Reports are logged, never stored:
 * the endpoint is unauthenticated because the browser sends these without
 * credentials.
 */
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }

    const parsed = JSON.parse(raw) as CspReportBody;
    const report = parsed["csp-report"];
    if (report && typeof report === "object") {
      console.warn("[csp] %s", summarize(report));
    } else {
      console.warn("[csp] unrecognised report payload", raw.slice(0, 512));
    }
  } catch {
    // A malformed report is not worth a 4xx round trip to the browser.
  }

  return new NextResponse(null, { status: 204 });
}
