import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { uploadBookingRequestImage } from "@/lib/onboarding/services/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function resolveBusinessFromSlug(
  slug: string,
): Promise<{ id: string } | null> {
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  if (!isTenantAccessAllowed(data.status, data.isActive)) {
    return null;
  }
  return { id: doc.id };
}

async function readCustomerUid(
  request: Request,
): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid upload request." },
        { status: 400 },
      );
    }

    const file = formData.get("file");
    const slugRaw = formData.get("slug");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Please choose an image file." },
        { status: 400 },
      );
    }

    const slug = typeof slugRaw === "string" ? slugRaw.trim() : "";
    if (!slug) {
      return NextResponse.json(
        { ok: false, error: "Booking link is invalid." },
        { status: 400 },
      );
    }

    const business = await resolveBusinessFromSlug(slug);
    if (!business) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This business is not accepting bookings right now. Please contact them directly.",
        },
        { status: 403 },
      );
    }

    const customerUid = (await readCustomerUid(request)) ?? "guest";
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadBookingRequestImage(buffer, file.type || "", {
      businessId: business.id,
      uid: customerUid,
      filename: file.name || "photo.jpg",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ok: true, imageUrl: result.imageUrl });
  } catch (error) {
    console.error("POST /api/uploads/booking-image failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not upload image." },
      { status: 500 },
    );
  }
}
