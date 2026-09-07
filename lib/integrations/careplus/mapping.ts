import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { isCareplusSecretConfigured } from "@/lib/integrations/careplus/config";
import {
  CAREPLUS_INTEGRATIONS_COLLECTION,
  CAREPLUS_STAFF_MAPPINGS_COLLECTION,
} from "@/lib/integrations/careplus/constants";
import type {
  CareplusIntegrationRecord,
  CareplusIntegrationStatus,
  CareplusStaffMappingRecord,
} from "@/lib/integrations/careplus/types";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapIntegrationDoc(
  businessId: string,
  data: DocumentData,
): CareplusIntegrationRecord {
  const status: CareplusIntegrationStatus =
    data.status === "revoked" ? "revoked" : "active";
  return {
    businessId,
    businessName: asString(data.businessName),
    careplusProviderId: asString(data.careplusProviderId) ?? "",
    status,
    mappingRevision:
      typeof data.mappingRevision === "number" ? data.mappingRevision : 1,
    verifiedBy: asString(data.verifiedBy),
    verifiedAt: toMillis(data.verifiedAt),
    revokedAt: toMillis(data.revokedAt),
    lastEventStatus: asString(data.lastEventStatus),
    lastEventAt: toMillis(data.lastEventAt),
    lastLearningAt: toMillis(data.lastLearningAt),
    lastErrorCode: asString(data.lastErrorCode),
    secretConfigured: isCareplusSecretConfigured(businessId),
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

export async function getCareplusIntegration(
  businessId: string,
): Promise<CareplusIntegrationRecord | null> {
  const snap = await adminDb
    .collection(CAREPLUS_INTEGRATIONS_COLLECTION)
    .doc(businessId)
    .get();
  if (!snap.exists) return null;
  return mapIntegrationDoc(snap.id, snap.data() ?? {});
}

export async function listCareplusIntegrations(): Promise<
  CareplusIntegrationRecord[]
> {
  const snap = await adminDb.collection(CAREPLUS_INTEGRATIONS_COLLECTION).get();
  return snap.docs
    .map((doc) => mapIntegrationDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function upsertCareplusIntegration(input: {
  businessId: string;
  careplusProviderId: string;
  actorUid: string;
  actorEmail: string | undefined;
}): Promise<CareplusIntegrationRecord> {
  const businessId = input.businessId.trim();
  const careplusProviderId = input.careplusProviderId.trim();
  if (!businessId) throw new Error("BMS business ID is required.");
  if (!careplusProviderId) throw new Error("CarePlus provider ID is required.");

  const businessSnap = await adminDb.collection("businesses").doc(businessId).get();
  if (!businessSnap.exists) {
    throw new Error("Tenant not found.");
  }
  const businessName =
    asString(businessSnap.data()?.businessName) ??
    asString(businessSnap.data()?.name);

  const duplicate = await adminDb
    .collection(CAREPLUS_INTEGRATIONS_COLLECTION)
    .where("careplusProviderId", "==", careplusProviderId)
    .limit(10)
    .get();
  const takenByOther = duplicate.docs.find((doc) => {
    const status = doc.data()?.status;
    return doc.id !== businessId && status === "active";
  });
  if (takenByOther) {
    throw new Error(
      "That CarePlus provider is already mapped to another BMS business.",
    );
  }

  const ref = adminDb.collection(CAREPLUS_INTEGRATIONS_COLLECTION).doc(businessId);
  const existing = await ref.get();
  const nextRevision =
    existing.exists && typeof existing.data()?.mappingRevision === "number"
      ? existing.data()!.mappingRevision + 1
      : 1;

  await ref.set(
    {
      businessId,
      businessName,
      careplusProviderId,
      status: "active",
      mappingRevision: nextRevision,
      verifiedBy: input.actorUid,
      verifiedAt: FieldValue.serverTimestamp(),
      revokedAt: null,
      lastErrorCode: null,
      createdAt: existing.exists
        ? existing.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const saved = await ref.get();
  return mapIntegrationDoc(saved.id, saved.data() ?? {});
}

export async function revokeCareplusIntegration(
  businessId: string,
): Promise<CareplusIntegrationRecord> {
  const ref = adminDb
    .collection(CAREPLUS_INTEGRATIONS_COLLECTION)
    .doc(businessId.trim());
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("CarePlus mapping not found.");
  }

  await ref.set(
    {
      status: "revoked",
      revokedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const saved = await ref.get();
  return mapIntegrationDoc(saved.id, saved.data() ?? {});
}

export async function touchCareplusIntegration(
  businessId: string,
  patch: {
    lastEventStatus?: string | null;
    lastEventAt?: FieldValue;
    lastLearningAt?: FieldValue;
    lastErrorCode?: string | null;
  },
): Promise<void> {
  await adminDb
    .collection(CAREPLUS_INTEGRATIONS_COLLECTION)
    .doc(businessId)
    .set(
      {
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function listCareplusStaffMappings(
  businessId: string,
): Promise<CareplusStaffMappingRecord[]> {
  const snap = await adminDb
    .collection(CAREPLUS_STAFF_MAPPINGS_COLLECTION)
    .where("businessId", "==", businessId)
    .get();
  return snap.docs.map((doc) => {
    const data = doc.data() ?? {};
    return {
      id: doc.id,
      businessId,
      bmsStaffUid: asString(data.bmsStaffUid) ?? "",
      bmsStaffName: asString(data.bmsStaffName),
      careplusStaffId: asString(data.careplusStaffId) ?? "",
      status: data.status === "revoked" ? "revoked" : "active",
      verifiedBy: asString(data.verifiedBy),
      verifiedAt: toMillis(data.verifiedAt),
      mappingRevision:
        typeof data.mappingRevision === "number" ? data.mappingRevision : 1,
    };
  });
}

export async function upsertCareplusStaffMapping(input: {
  businessId: string;
  bmsStaffUid: string;
  bmsStaffName: string | null;
  careplusStaffId: string;
  actorUid: string;
}): Promise<CareplusStaffMappingRecord> {
  const businessId = input.businessId.trim();
  const bmsStaffUid = input.bmsStaffUid.trim();
  const careplusStaffId = input.careplusStaffId.trim();
  if (!businessId || !bmsStaffUid || !careplusStaffId) {
    throw new Error("Business, BMS staff, and CarePlus staff IDs are required.");
  }

  const mappingId = `${businessId}_${bmsStaffUid}`;
  const ref = adminDb.collection(CAREPLUS_STAFF_MAPPINGS_COLLECTION).doc(mappingId);
  const existing = await ref.get();
  const nextRevision =
    existing.exists && typeof existing.data()?.mappingRevision === "number"
      ? existing.data()!.mappingRevision + 1
      : 1;

  await ref.set({
    businessId,
    bmsStaffUid,
    bmsStaffName: input.bmsStaffName,
    careplusStaffId,
    status: "active",
    verifiedBy: input.actorUid,
    verifiedAt: FieldValue.serverTimestamp(),
    mappingRevision: nextRevision,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: existing.exists
      ? existing.data()?.createdAt ?? FieldValue.serverTimestamp()
      : FieldValue.serverTimestamp(),
  });

  const saved = await ref.get();
  const data = saved.data() ?? {};
  return {
    id: saved.id,
    businessId,
    bmsStaffUid,
    bmsStaffName: asString(data.bmsStaffName),
    careplusStaffId,
    status: "active",
    verifiedBy: input.actorUid,
    verifiedAt: toMillis(data.verifiedAt) ?? Date.now(),
    mappingRevision: nextRevision,
  };
}

export async function listBusinessStaffDirectory(businessId: string): Promise<
  Array<{ uid: string; fullName: string | null; email: string | null; role: string }>
> {
  const snap = await adminDb
    .collection("users")
    .where("businessId", "==", businessId)
    .get();

  return snap.docs
    .map((doc) => {
      const data = doc.data() ?? {};
      const role = asString(data.role) ?? "staff";
      return {
        uid: doc.id,
        fullName: asString(data.fullName) ?? asString(data.name),
        email: asString(data.email),
        role,
      };
    })
    .filter((row) =>
      ["staff", "admin", "owner", "business_owner"].includes(row.role),
    )
    .sort((a, b) => (a.fullName ?? a.uid).localeCompare(b.fullName ?? b.uid));
}
