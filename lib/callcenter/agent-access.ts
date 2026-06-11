import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";

export type CallCenterAgentProfile = {
  fullName: string | null;
  extension: string | null;
  agentType: string | null;
  isActive: boolean;
};

/**
 * Returns true when this Firebase Auth user is a call-center agent according to
 * Firestore — checks users/{uid}, users by email, call_center_agents/{uid},
 * and call_center_agents by email.
 */
export async function resolveCallCenterAgentProfile(
  uid: string,
  email: string,
): Promise<CallCenterAgentProfile | null> {
  const normalizedEmail = email.trim().toLowerCase();

  const userByUid = await adminDb.collection("users").doc(uid).get();
  if (userByUid.exists) {
    const data = userByUid.data() ?? {};
    const role = typeof data.role === "string" ? data.role : "";
    if (role === "call_center") {
      return mapAgentProfile(data);
    }
  }

  const usersByEmail = await adminDb
    .collection("users")
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();
  if (!usersByEmail.empty) {
    const data = usersByEmail.docs[0].data();
    const role = typeof data.role === "string" ? data.role : "";
    if (role === "call_center") {
      return mapAgentProfile(data);
    }
  }

  const agentByUid = await adminDb.collection("call_center_agents").doc(uid).get();
  if (agentByUid.exists) {
    return mapAgentProfile(agentByUid.data() ?? {});
  }

  const agentsByEmail = await adminDb
    .collection("call_center_agents")
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();
  if (!agentsByEmail.empty) {
    return mapAgentProfile(agentsByEmail.docs[0].data());
  }

  return null;
}

function mapAgentProfile(data: Record<string, unknown>): CallCenterAgentProfile {
  const status = typeof data.status === "string" ? data.status : "active";
  const isActive =
    data.isActive !== false && status !== "inactive" && status !== "disabled";

  return {
    fullName:
      typeof data.fullName === "string"
        ? data.fullName
        : typeof data.displayName === "string"
          ? data.displayName
          : typeof data.name === "string"
            ? data.name
            : null,
    extension: typeof data.extension === "string" ? data.extension : null,
    agentType: typeof data.agentType === "string" ? data.agentType : null,
    isActive,
  };
}

/** Ensures JWT custom claims match a registered call-center agent. */
export async function ensureCallCenterAgentClaims(
  uid: string,
  profile: CallCenterAgentProfile,
): Promise<void> {
  await adminAuth.setCustomUserClaims(uid, {
    role: "call_center",
    ...(profile.agentType ? { agentType: profile.agentType } : {}),
  });
}

/** Keeps users/{uid} in sync when the agent record lives elsewhere. */
export async function syncCallCenterUserDoc(
  uid: string,
  email: string,
  profile: CallCenterAgentProfile,
): Promise<void> {
  const ref = adminDb.collection("users").doc(uid);
  const snap = await ref.get();
  const base = {
    uid,
    email: email.trim().toLowerCase(),
    fullName: profile.fullName,
    extension: profile.extension,
    agentType: profile.agentType,
    role: "call_center",
    status: profile.isActive ? "active" : "inactive",
    isActive: profile.isActive,
    updatedAt: new Date(),
  };

  if (snap.exists) {
    await ref.set(base, { merge: true });
  } else {
    await ref.set({
      ...base,
      createdAt: new Date(),
    });
  }
}
