import {
  listDirectoryCustomers,
  listDirectoryStaff,
  listDirectoryTenants,
  linkDirectoryProvider,
} from "@/lib/integrations/careplus/directory";
import {
  DirectoryAuthError,
  verifyCareplusDirectoryRequest,
} from "@/lib/integrations/careplus/directory-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BUSINESS_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const PROVIDER_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function fail(error: unknown) {
  if (error instanceof DirectoryAuthError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const message = error instanceof Error ? error.message : "Directory request failed.";
  const status =
    message.includes("required") ||
    message.includes("not found") ||
    message.includes("already mapped")
      ? 400
      : 500;
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    await verifyCareplusDirectoryRequest(request);
    const url = new URL(request.url);
    const view = url.searchParams.get("view") || "";
    const businessId = url.searchParams.get("businessId") || "";
    const allowed = new Set(["view", "businessId"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) {
        return NextResponse.json(
          { ok: false, error: "Unknown directory query parameter." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (view === "tenants") {
      if (businessId) {
        return NextResponse.json(
          { ok: false, error: "Tenant list does not accept a businessId." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        { ok: true, view, tenants: await listDirectoryTenants() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (view !== "customers" && view !== "staff") {
      return NextResponse.json(
        { ok: false, error: "view must be tenants, customers or staff." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!BUSINESS_ID.test(businessId)) {
      return NextResponse.json(
        { ok: false, error: "A valid businessId is required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const records =
      view === "customers"
        ? await listDirectoryCustomers(businessId)
        : await listDirectoryStaff(businessId);
    return NextResponse.json(
      { ok: true, view, businessId, records },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 4096) {
      return NextResponse.json(
        { ok: false, error: "Request too large." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    await verifyCareplusDirectoryRequest(request, raw);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const businessId =
      typeof body.businessId === "string" ? body.businessId.trim() : "";
    const careplusProviderId =
      typeof body.careplusProviderId === "string"
        ? body.careplusProviderId.trim()
        : "";
    if (!BUSINESS_ID.test(businessId) || !PROVIDER_ID.test(careplusProviderId)) {
      return NextResponse.json(
        { ok: false, error: "businessId and careplusProviderId are required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const integration = await linkDirectoryProvider({
      businessId,
      careplusProviderId,
    });
    return NextResponse.json(
      { ok: true, integration },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
