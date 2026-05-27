import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const STAFF_SKILLS = new Set([
  "Electrical",
  "Plumbing",
  "Carpentry",
  "HVAC",
  "General Maintenance",
]);

const STAFF_AVAILABILITY = new Set(["Weekdays", "Saturdays", "Sundays"]);

type StaffPayload = {
  fullName: string;
  email: string;
  phone: string;
  skills: string[];
  availability: string[];
};

type TimestampLike = {
  toDate: () => Date;
};

async function requireBusinessUser(request: Request): Promise<
  | { ok: true; uid: string; email: string | undefined; businessId: string }
  | { ok: false; status: number; error: string }
> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;

    if (!businessId || (role !== "owner" && role !== "admin")) {
      return { ok: false, status: 403, error: "Business owner access required." };
    }

    return { ok: true, uid: decoded.uid, email: decoded.email, businessId };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

function sanitizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function timestampMillis(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as TimestampLike).toDate === "function"
  ) {
    return (value as TimestampLike).toDate().getTime();
  }

  return 0;
}

function timestampIso(value: unknown) {
  const millis = timestampMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
}

function parseStaffPayload(raw: unknown):
  | { ok: true; value: StaffPayload }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }

  const input = raw as Record<string, unknown>;
  const fullName = sanitizeString(input.fullName);
  const email = sanitizeString(input.email).toLowerCase();
  const phone = sanitizeString(input.phone);
  const skills = Array.isArray(input.skills)
    ? input.skills.filter(
        (skill): skill is string =>
          typeof skill === "string" && STAFF_SKILLS.has(skill)
      )
    : [];
  const availability = Array.isArray(input.availability)
    ? input.availability.filter(
        (item): item is string =>
          typeof item === "string" && STAFF_AVAILABILITY.has(item)
      )
    : [];

  if (!fullName) {
    return { ok: false, error: "Full name is required." };
  }

  if (!phone) {
    return { ok: false, error: "Mobile number is required." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "A valid email address is required." };
  }

  if (skills.length === 0) {
    return { ok: false, error: "Select at least one working skill." };
  }

  if (availability.length === 0) {
    return { ok: false, error: "Select at least one availability option." };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
      skills,
      availability,
    },
  };
}

export async function POST(request: Request) {
  const auth = await requireBusinessUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const parsed = parseStaffPayload(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const existing = await adminDb
    .collection("users")
    .where("email", "==", parsed.value.email)
    .limit(1)
    .get();

  if (!existing.empty) {
    return NextResponse.json(
      { ok: false, error: "A user with this email already exists." },
      { status: 400 }
    );
  }

  const staffRef = adminDb.collection("users").doc();
  const now = FieldValue.serverTimestamp();

  await staffRef.set({
    uid: staffRef.id,
    email: parsed.value.email,
    fullName: parsed.value.fullName,
    phone: parsed.value.phone,
    businessId: auth.businessId,
    role: "staff",
    skills: parsed.value.skills,
    availability: parsed.value.availability,
    status: "invited",
    isActive: true,
    createdByUid: auth.uid,
    createdByEmail: auth.email ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json(
    { ok: true, staffId: staffRef.id },
    { status: 201 }
  );
}

export async function GET(request: Request) {
  const auth = await requireBusinessUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const snapshot = await adminDb
    .collection("users")
    .where("businessId", "==", auth.businessId)
    .get();

  const staff = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        fullName: sanitizeString(data.fullName) || "Unnamed Staff",
        email: sanitizeString(data.email),
        phone: sanitizeString(data.phone) || null,
        role: sanitizeString(data.role),
        skills: sanitizeStringArray(data.skills),
        availability: sanitizeStringArray(data.availability),
        status: sanitizeString(data.status) || "active",
        createdAt: timestampIso(data.createdAt),
        createdAtMillis: timestampMillis(data.createdAt),
      };
    })
    .filter((member) => member.role === "staff")
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis)
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      email: member.email,
      phone: member.phone,
      skills: member.skills,
      availability: member.availability,
      status: member.status,
      createdAt: member.createdAt,
    }));

  return NextResponse.json({ ok: true, staff });
}
