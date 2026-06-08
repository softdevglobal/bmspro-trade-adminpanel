import "server-only";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  isReservedSlug,
  slugifyBusinessName,
} from "@/lib/onboarding/booking-slug";
import {
  validateOnboardingPayload,
  SUBSCRIPTION_PLANS,
  ADMIN_CREATED_DEFAULT_PASSWORD,
  type OnboardingPayload,
  type TenantSource,
  type TenantStatus,
} from "@/lib/onboarding/types";
import { sendOwnerWelcomeEmail } from "@/lib/email/templates";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";

/**
 * Find an unused booking slug for a new business. Falls back to appending a
 * short random suffix if the preferred slug is taken or reserved.
 */
async function reserveBookingSlug(name: string): Promise<string> {
  const base = slugifyBusinessName(name) || "business";
  const candidates = [base];
  if (isReservedSlug(base)) candidates.length = 0;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate =
      candidates.shift() ??
      `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (isReservedSlug(candidate)) continue;
    const existing = await adminDb
      .collection("businesses")
      .where("bookingSlug", "==", candidate)
      .limit(1)
      .get();
    if (existing.empty) return candidate;
  }
  // Last resort — should never get here.
  return `${base}-${Date.now().toString(36)}`;
}

type CreateTenantOptions = {
  source: TenantSource;
  status: TenantStatus;
  createdByUid?: string | null;
  createdByEmail?: string | null;
};

export type CreateTenantResult =
  | { ok: true; tenantId: string; uid?: string }
  | { ok: false; error: string };

/**
 * Verify that a request bears a valid Firebase ID token belonging to a
 * super-admin user. Returns the decoded token on success.
 */
export async function requireSuperAdmin(req: Request): Promise<
  | { ok: true; uid: string; email: string | undefined }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const isSuperAdmin =
      decoded.superAdmin === true || decoded.role === "super_admin";

    if (!isSuperAdmin) {
      const snap = await adminDb
        .collection("super_admins")
        .doc(decoded.uid)
        .get();
      if (!snap.exists || snap.data()?.isActive === false) {
        return { ok: false, status: 403, error: "Super admin access required." };
      }
    }

    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

export async function createTenantFromPayload(
  raw: Partial<OnboardingPayload>,
  options: CreateTenantOptions
): Promise<CreateTenantResult> {
  const validated = validateOnboardingPayload(raw, { requirePassword: false });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  return createTenantWithOwnerAccount(validated.value, {
    password: ADMIN_CREATED_DEFAULT_PASSWORD,
    status: options.status,
    source: options.source,
    createdByUid: options.createdByUid ?? null,
    createdByEmail: options.createdByEmail ?? null,
  });
}

async function createTenantWithOwnerAccount(
  value: OnboardingPayload,
  options: {
    password: string;
    status: TenantStatus;
    source: TenantSource;
    createdByUid?: string | null;
    createdByEmail?: string | null;
  }
): Promise<CreateTenantResult> {
  try {
    await adminAuth.getUserByEmail(value.accountEmail);
    return {
      ok: false,
      error: "An account with this email already exists.",
    };
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      return { ok: false, error: "Could not verify email availability." };
    }
  }

  let uid: string | null = null;

  try {
    const authUser = await adminAuth.createUser({
      email: value.accountEmail,
      password: options.password,
      displayName: value.ownerFullName || value.businessName,
      emailVerified: false,
    });
    uid = authUser.uid;

    const businessRef = adminDb.collection("businesses").doc();
    const tenantId = businessRef.id;
    const now = FieldValue.serverTimestamp();
    const bookingSlug = await reserveBookingSlug(value.businessName);

    await adminAuth.setCustomUserClaims(uid, {
      role: "owner",
      businessId: tenantId,
    });

    const batch = adminDb.batch();
    batch.set(
      businessRef,
      businessDocument(businessRef, value, {
        status: options.status,
        source: options.source,
        ownerUid: uid,
        bookingSlug,
        createdByUid: options.createdByUid ?? null,
        createdByEmail: options.createdByEmail ?? null,
      })
    );
    batch.set(adminDb.collection("users").doc(uid), {
      uid,
      email: value.accountEmail,
      fullName: value.ownerFullName || null,
      businessId: tenantId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();

    const planName =
      SUBSCRIPTION_PLANS.find((p) => p.id === value.selectedPlanId)?.name ??
      null;
    await sendOwnerWelcomeEmail({
      email: value.accountEmail,
      ownerName: value.ownerFullName || null,
      businessName: value.businessName,
      bookingSlug,
      planName,
      logoUrl: value.logoUrl ?? null,
      temporaryPassword:
        options.source === "super_admin_create"
          ? options.password
          : null,
    });

    return { ok: true, tenantId, uid };
  } catch (error: unknown) {
    if (uid) {
      try {
        await adminAuth.deleteUser(uid);
      } catch {
        /* rollback best-effort */
      }
    }

    const code = (error as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      return {
        ok: false,
        error: "An account with this email already exists.",
      };
    }
    if (code === "auth/weak-password") {
      return { ok: false, error: "Could not set the default account password." };
    }

    console.error("createTenantWithOwnerAccount failed:", error);
    return { ok: false, error: "Could not create the tenant. Please try again." };
  }
}

function businessDocument(
  ref: DocumentReference,
  value: OnboardingPayload,
  options: {
    status: TenantStatus;
    source: TenantSource;
    ownerUid?: string | null;
    bookingSlug: string;
    createdByUid?: string | null;
    createdByEmail?: string | null;
  }
) {
  const selectedPlan = SUBSCRIPTION_PLANS.find((p) => p.id === value.selectedPlanId);
  const now = FieldValue.serverTimestamp();

  return {
    id: ref.id,
    businessName: value.businessName,
    businessType: value.businessType,
    abn: value.abn || null,
    businessStructure: value.businessStructure,
    registeredForGst: value.registeredForGst,
    gstPercentage: value.registeredForGst ? 10 : null,
    businessAddress: value.businessAddress || null,
    state: value.state,
    postcode: value.postcode,
    timezone: value.timezone,
    businessPhone: value.businessPhone,
    businessEmail: value.accountEmail,
    mainSuburb: `${value.state}, ${value.postcode}`,
    serviceAreas: value.serviceAreas,
    logoUrl: value.logoUrl ?? null,
    bookingSlug: options.bookingSlug,
    bookingPath: `/booknow/${options.bookingSlug}`,
    ownerUid: options.ownerUid ?? null,
    owner: {
      fullName: value.ownerFullName || null,
      email: value.accountEmail,
    },
    plan: selectedPlan
      ? {
          id: selectedPlan.id,
          name: selectedPlan.name,
          price: selectedPlan.price,
          period: selectedPlan.period,
          trialDays: selectedPlan.trialDays,
        }
      : null,
    status: options.status,
    source: options.source,
    isActive: options.status === "active",
    onboardingProgress: 100,
    onboardingStep: "complete",
    createdByUid: options.createdByUid ?? null,
    createdByEmail: options.createdByEmail ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Reads a small profile for the current owner's business. */
export type BusinessProfile = {
  businessName: string | null;
  logoUrl: string | null;
  bookingSlug: string | null;
  bookingPath: string | null;
  registeredForGst: boolean;
  gstPercentage: number | null;
  businessAddress: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  abn: string | null;
  termsAndConditions: string | null;
};

function parseGstPercentage(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < 0 || raw > 100) return null;
  return Math.round(raw * 100) / 100;
}

export async function getBusinessProfile(
  businessId: string,
): Promise<BusinessProfile | null> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const slug =
    typeof data.bookingSlug === "string" ? data.bookingSlug : null;
  const registeredForGst = Boolean(data.registeredForGst);
  const parsedGst = parseGstPercentage(data.gstPercentage);
  return {
    businessName:
      typeof data.businessName === "string" ? data.businessName : null,
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
    bookingSlug: slug,
    bookingPath:
      typeof data.bookingPath === "string"
        ? data.bookingPath
        : slug
          ? `/booknow/${slug}`
          : null,
    registeredForGst,
    gstPercentage: registeredForGst ? (parsedGst ?? 10) : null,
    businessAddress:
      typeof data.businessAddress === "string" ? data.businessAddress : null,
    businessEmail:
      typeof data.businessEmail === "string" ? data.businessEmail : null,
    businessPhone:
      typeof data.businessPhone === "string" ? data.businessPhone : null,
    abn: typeof data.abn === "string" ? data.abn : null,
    termsAndConditions:
      typeof data.termsAndConditions === "string" &&
      data.termsAndConditions.trim()
        ? data.termsAndConditions.trim()
        : null,
  };
}

/** Updates editable business profile fields for the settings page. */
export async function updateBusinessProfile(
  businessId: string,
  updates: {
    businessName?: string | null;
    businessAddress?: string | null;
    businessEmail?: string | null;
    businessPhone?: string | null;
    abn?: string | null;
    logoUrl?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
    termsAndConditions?: string | null;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if ("businessName" in updates) {
    payload.businessName = updates.businessName;
  }

  if ("businessAddress" in updates) {
    payload.businessAddress = updates.businessAddress;
  }

  if ("businessEmail" in updates) {
    payload.businessEmail = updates.businessEmail;
  }

  if ("businessPhone" in updates) {
    payload.businessPhone = updates.businessPhone;
  }

  if ("abn" in updates) {
    payload.abn = updates.abn;
  }

  if ("logoUrl" in updates) {
    payload.logoUrl = updates.logoUrl;
  }

  if ("registeredForGst" in updates) {
    payload.registeredForGst = updates.registeredForGst;
    if (updates.registeredForGst === false) {
      payload.gstPercentage = null;
    }
  }

  if ("gstPercentage" in updates) {
    payload.gstPercentage = updates.gstPercentage;
  }

  if ("termsAndConditions" in updates) {
    payload.termsAndConditions = updates.termsAndConditions;
  }

  await adminDb.collection("businesses").doc(businessId).update(payload);
}

/** Updates (or clears) the logo on a business document. */
export async function updateBusinessLogo(
  businessId: string,
  logoUrl: string | null,
): Promise<void> {
  await updateBusinessProfile(businessId, { logoUrl });
}

export type BusinessMemberAuth = {
  ok: true;
  uid: string;
  email: string | undefined;
  businessId: string;
  role: string;
};

/**
 * Verifies owner, admin, or staff with a businessId claim (admin panel users).
 */
export async function requireBusinessMember(req: Request): Promise<
  BusinessMemberAuth | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;

    if (
      !businessId ||
      (role !== "owner" && role !== "admin" && role !== "staff")
    ) {
      return {
        ok: false,
        status: 403,
        error: "Business member access required.",
      };
    }

    return {
      ok: true,
      uid: decoded.uid,
      email: decoded.email,
      businessId,
      role: typeof role === "string" ? role : "staff",
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

async function resolveBusinessIdFromBookingSlug(
  slug: string,
): Promise<string | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", trimmed)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

export type AuditLogAccess =
  | { ok: true; scope: "platform"; uid: string; email: string | undefined }
  | {
      ok: true;
      scope: "tenant";
      uid: string;
      email: string | undefined;
      businessId: string;
      role: string;
    }
  | {
      ok: true;
      scope: "customer";
      uid: string;
      email: string | undefined;
      businessId: string;
    };

/**
 * Resolves who may read audit logs and how results must be scoped.
 * Super admin → all tenants; owner/staff → own business; customer → own activity.
 */
export async function resolveAuditLogAccess(
  req: Request,
  options?: { bookingSlug?: string | null },
): Promise<AuditLogAccess | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const claimRole = decoded.role;
    const isSuperAdminClaim =
      decoded.superAdmin === true || claimRole === "super_admin";

    if (isSuperAdminClaim) {
      return { ok: true, scope: "platform", uid: decoded.uid, email: decoded.email };
    }

    const superSnap = await adminDb
      .collection("super_admins")
      .doc(decoded.uid)
      .get();
    if (superSnap.exists && superSnap.data()?.isActive !== false) {
      return { ok: true, scope: "platform", uid: decoded.uid, email: decoded.email };
    }

    const businessIdClaim =
      typeof decoded.businessId === "string" ? decoded.businessId : null;

    if (
      businessIdClaim &&
      (claimRole === "owner" || claimRole === "admin" || claimRole === "staff")
    ) {
      return {
        ok: true,
        scope: "tenant",
        uid: decoded.uid,
        email: decoded.email,
        businessId: businessIdClaim,
        role: typeof claimRole === "string" ? claimRole : "staff",
      };
    }

    const customerSnap = await adminDb.collection("customers").doc(decoded.uid).get();
    if (!customerSnap.exists) {
      return { ok: false, status: 403, error: "Access denied." };
    }

    const data = customerSnap.data() ?? {};
    let businessId =
      typeof data.registeredBusinessId === "string"
        ? data.registeredBusinessId
        : null;
    const storedSlug =
      typeof data.registeredBookingSlug === "string"
        ? data.registeredBookingSlug
        : null;
    const slug = (options?.bookingSlug?.trim() || storedSlug || "").trim();

    if (!businessId && slug) {
      businessId = await resolveBusinessIdFromBookingSlug(slug);
    }

    if (!businessId) {
      return {
        ok: false,
        status: 403,
        error: "Could not determine your business.",
      };
    }

    return {
      ok: true,
      scope: "customer",
      uid: decoded.uid,
      email: decoded.email,
      businessId,
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

export async function registerSelfSignupTenant(
  raw: Partial<OnboardingPayload>
): Promise<CreateTenantResult> {
  const validated = validateOnboardingPayload(raw, { requirePassword: true });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  const value = validated.value;
  const password = value.password!;

  return createTenantWithOwnerAccount(value, {
    password,
    status: "active",
    source: "self_signup",
  });
}
