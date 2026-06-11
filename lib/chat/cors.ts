import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tenant-Id",
};

export function chatJson(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: CORS_HEADERS,
  });
}

export function chatOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
