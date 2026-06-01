import { sendStaffWelcomeEmail } from "@/lib/email/account-emails";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const WEEK_DAY_IDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
const WEEK_DAYS = new Set<string>(WEEK_DAY_IDS);
const DEFAULT_STAFF_PASSWORD = "00001111";

type DayAvailability = {
  day: string;
  isOff: boolean;
  serviceAreas: string[];
};

type StaffPayload = {
  fullName: string;
  email: string;
  phone: string;
  staffType: string;
  availability: DayAvailability[];
  canget_qutaion: boolean;
};

type StaffUpdatePayload = StaffPayload & {
  id: string;
};

type StaffStatus = "active" | "suspended";

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

function parseAvailability(value: unknown, allowedServiceAreas: string[]) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => {
      return Boolean(item) && typeof item === "object";
    })
    .map((item) => {
      const day = sanitizeString(item.day).toLowerCase();
      return {
        day,
        isOff: item.isOff === true,
        serviceAreas: sanitizeStringArray(item.serviceAreas)
          .filter(
            (area) =>
              allowedServiceAreas.length === 0 ||
              allowedServiceAreas.includes(area),
          )
          .slice(0, 1),
      };
    })
    .filter((item) => WEEK_DAYS.has(item.day));
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

function parseStaffPayload(raw: unknown, allowedServiceAreas: string[]):
  | { ok: true; value: StaffPayload }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }

  const input = raw as Record<string, unknown>;
  const fullName = sanitizeString(input.fullName);
  const email = sanitizeString(input.email).toLowerCase();
  const phone = sanitizeString(input.phone).replace(/\D/g, "");
  const staffType = sanitizeString(input.staffType);
  const availability = parseAvailability(input.availability, allowedServiceAreas);
  const canget_qutaion = input.canget_qutaion === true;

  if (!fullName) {
    return { ok: false, error: "Full name is required." };
  }

  if (!phone) {
    return { ok: false, error: "Mobile number is required (digits only)." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "A valid email address is required." };
  }

  if (!staffType) {
    return { ok: false, error: "Type a staff role." };
  }

  const workingDays = availability.filter((day) => !day.isOff);
  if (availability.length !== WEEK_DAYS.size || workingDays.length === 0) {
    return { ok: false, error: "Select at least one availability option." };
  }

  if (
    allowedServiceAreas.length > 0 &&
    workingDays.some((day) => day.serviceAreas.length === 0)
  ) {
    return {
      ok: false,
      error: "Select one service area for each working day or mark it off.",
    };
  }

  if (
    allowedServiceAreas.length > 0 &&
    workingDays.some((day) => day.serviceAreas.length > 1)
  ) {
    return {
      ok: false,
      error: "Only one service area can be selected per day.",
    };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
      staffType,
      availability,
      canget_qutaion,
    },
  };
}

function parseStaffUpdatePayload(raw: unknown, allowedServiceAreas: string[]):
  | { ok: true; value: StaffUpdatePayload }
  | { ok: false; error: string } {
  const parsed = parseStaffPayload(raw, allowedServiceAreas);
  if (!parsed.ok) return parsed;

  const id =
    raw && typeof raw === "object"
      ? sanitizeString((raw as Record<string, unknown>).id)
      : "";
  if (!id) {
    return { ok: false, error: "Staff ID is required." };
  }

  return { ok: true, value: { ...parsed.value, id } };
}

function parseStaffStatusPayload(raw: unknown):
  | { ok: true; value: { id: string; status: StaffStatus } }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }

  const input = raw as Record<string, unknown>;
  const id = sanitizeString(input.id);
  const status = sanitizeString(input.status);

  if (!id) {
    return { ok: false, error: "Staff ID is required." };
  }

  if (status !== "active" && status !== "suspended") {
    return { ok: false, error: "Invalid staff status." };
  }

  return { ok: true, value: { id, status } };
}

function staffStatus(value: unknown): StaffStatus {
  return value === "suspended" ? "suspended" : "active";
}

async function getBusinessServiceAreas(businessId: string) {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  const areas = snap.data()?.serviceAreas;
  return sanitizeStringArray(areas);
}

function staffType(value: unknown, legacySkills: unknown) {
  const type = sanitizeString(value);
  if (type) return type;

  const skills = sanitizeStringArray(legacySkills);
  if (skills.some((skill) => skill.toLowerCase() === "electrical")) {
    return "Electrician";
  }
  if (skills.some((skill) => skill.toLowerCase() === "plumbing")) {
    return "Plumber";
  }

  return "";
}

function availabilityForResponse(
  value: unknown,
  serviceAreas: string[],
): DayAvailability[] {
  if (Array.isArray(value) && value.some((item) => typeof item === "object")) {
    const parsed = parseAvailability(value, serviceAreas);
    return WEEK_DAY_IDS.map((day) => {
      const existing = parsed.find((item) => item.day === day);
      return (
        existing ?? {
          day,
          isOff: false,
          serviceAreas: [],
        }
      );
    });
  }

  const legacy = sanitizeStringArray(value);
  return WEEK_DAY_IDS.map((day) => {
    const isWeekday = !["saturday", "sunday"].includes(day);
    const available =
      (isWeekday && legacy.includes("Weekdays")) ||
      (day === "saturday" && legacy.includes("Saturdays")) ||
      (day === "sunday" && legacy.includes("Sundays"));

    return {
      day,
      isOff: !available,
      serviceAreas: available ? serviceAreas : [],
    };
  });
}

async function getOwnedStaffRef(
  staffId: string,
  businessId: string
): Promise<
  | { ok: true; ref: DocumentReference }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection("users").doc(staffId);
  const snap = await ref.get();

  if (!snap.exists) {
    return { ok: false, status: 404, error: "Staff member not found." };
  }

  const data = snap.data();
  if (data?.businessId !== businessId || data?.role !== "staff") {
    return { ok: false, status: 404, error: "Staff member not found." };
  }

  return { ok: true, ref };
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

  const serviceAreas = await getBusinessServiceAreas(auth.businessId);
  const parsed = parseStaffPayload(body, serviceAreas);
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

  try {
    await adminAuth.getUserByEmail(parsed.value.email);
    return NextResponse.json(
      { ok: false, error: "A user with this email already exists." },
      { status: 400 }
    );
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      return NextResponse.json(
        { ok: false, error: "Could not verify email availability." },
        { status: 400 }
      );
    }
  }

  let authUid: string | null = null;
  const now = FieldValue.serverTimestamp();

  try {
    const authUser = await adminAuth.createUser({
      email: parsed.value.email,
      password: DEFAULT_STAFF_PASSWORD,
      displayName: parsed.value.fullName,
      emailVerified: false,
    });
    authUid = authUser.uid;

    await adminAuth.setCustomUserClaims(authUid, {
      role: "staff",
      businessId: auth.businessId,
    });

    await adminDb.collection("users").doc(authUid).set({
      uid: authUid,
      email: parsed.value.email,
      fullName: parsed.value.fullName,
      phone: parsed.value.phone,
      businessId: auth.businessId,
      role: "staff",
      staffType: parsed.value.staffType,
      availability: parsed.value.availability,
      canget_qutaion: parsed.value.canget_qutaion,
      status: "active",
      isActive: true,
      createdByUid: auth.uid,
      createdByEmail: auth.email ?? null,
      createdAt: now,
      updatedAt: now,
    });

    let welcomeEmailSent = false;
    try {
      const business = await getBusinessProfile(auth.businessId);
      welcomeEmailSent = await sendStaffWelcomeEmail({
        email: parsed.value.email,
        fullName: parsed.value.fullName,
        businessName: business?.businessName?.trim() || "your business",
        staffType: parsed.value.staffType,
        temporaryPassword: DEFAULT_STAFF_PASSWORD,
        logoUrl: business?.logoUrl ?? null,
      });
    } catch (emailError) {
      console.error("[staff] welcome email failed:", emailError);
    }

    return NextResponse.json(
      { ok: true, staffId: authUid, welcomeEmailSent },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (authUid) {
      try {
        await adminAuth.deleteUser(authUid);
      } catch {
        /* rollback best-effort */
      }
    }

    const code = (error as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { ok: false, error: "A user with this email already exists." },
        { status: 400 }
      );
    }

    console.error("create staff failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not create this staff member." },
      { status: 400 }
    );
  }
}

export async function GET(request: Request) {
  const auth = await requireBusinessUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const summaryOnly =
    new URL(request.url).searchParams.get("summary") === "1";
  const serviceAreas = summaryOnly
    ? []
    : await getBusinessServiceAreas(auth.businessId);
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
        staffType: staffType(data.staffType, data.skills),
        canget_qutaion: data.canget_qutaion === true,
        availability: summaryOnly
          ? {}
          : availabilityForResponse(data.availability, serviceAreas),
        status: staffStatus(data.status),
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
      staffType: member.staffType,
      canget_qutaion: member.canget_qutaion,
      availability: member.availability,
      status: member.status,
      createdAt: member.createdAt,
    }));

  return NextResponse.json({
    ok: true,
    staff,
    serviceAreas: summaryOnly ? [] : serviceAreas,
  });
}

export async function PATCH(request: Request) {
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

  if (
    body &&
    typeof body === "object" &&
    "status" in (body as Record<string, unknown>)
  ) {
    const parsedStatus = parseStaffStatusPayload(body);
    if (!parsedStatus.ok) {
      return NextResponse.json(parsedStatus, { status: 400 });
    }

    const owned = await getOwnedStaffRef(parsedStatus.value.id, auth.businessId);
    if (!owned.ok) {
      return NextResponse.json(
        { ok: false, error: owned.error },
        { status: owned.status }
      );
    }

    try {
      await adminAuth.updateUser(parsedStatus.value.id, {
        disabled: parsedStatus.value.status === "suspended",
      });
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== "auth/user-not-found") {
        return NextResponse.json(
          { ok: false, error: "Could not update this staff member account." },
          { status: 400 }
        );
      }
    }

    await owned.ref.update({
      status: parsedStatus.value.status,
      isActive: parsedStatus.value.status === "active",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      staffId: parsedStatus.value.id,
      status: parsedStatus.value.status,
    });
  }

  const serviceAreas = await getBusinessServiceAreas(auth.businessId);
  const parsed = parseStaffUpdatePayload(body, serviceAreas);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const owned = await getOwnedStaffRef(parsed.value.id, auth.businessId);
  if (!owned.ok) {
    return NextResponse.json(
      { ok: false, error: owned.error },
      { status: owned.status }
    );
  }

  const existing = await adminDb
    .collection("users")
    .where("email", "==", parsed.value.email)
    .limit(2)
    .get();

  const duplicate = existing.docs.some((doc) => doc.id !== parsed.value.id);
  if (duplicate) {
    return NextResponse.json(
      { ok: false, error: "A user with this email already exists." },
      { status: 400 }
    );
  }

  try {
    await adminAuth.updateUser(parsed.value.id, {
      email: parsed.value.email,
      displayName: parsed.value.fullName,
    });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { ok: false, error: "A user with this email already exists." },
        { status: 400 }
      );
    }
    if (code !== "auth/user-not-found") {
      return NextResponse.json(
        { ok: false, error: "Could not update this staff member account." },
        { status: 400 }
      );
    }
  }

  await owned.ref.update({
    email: parsed.value.email,
    fullName: parsed.value.fullName,
    phone: parsed.value.phone,
    staffType: parsed.value.staffType,
    availability: parsed.value.availability,
    canget_qutaion: parsed.value.canget_qutaion,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, staffId: parsed.value.id });
}

export async function DELETE(request: Request) {
  const auth = await requireBusinessUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const staffId = sanitizeString(new URL(request.url).searchParams.get("id"));
  if (!staffId) {
    return NextResponse.json(
      { ok: false, error: "Staff ID is required." },
      { status: 400 }
    );
  }

  const owned = await getOwnedStaffRef(staffId, auth.businessId);
  if (!owned.ok) {
    return NextResponse.json(
      { ok: false, error: owned.error },
      { status: owned.status }
    );
  }

  await owned.ref.delete();
  try {
    await adminAuth.deleteUser(staffId);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      return NextResponse.json(
        { ok: false, error: "Staff was removed, but auth cleanup failed." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
