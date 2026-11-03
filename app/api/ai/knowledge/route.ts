import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notImplemented = () => NextResponse.json({ error: "Not implemented." }, { status: 501 });

export function GET() {
  return notImplemented();
}

export function POST() {
  return notImplemented();
}
