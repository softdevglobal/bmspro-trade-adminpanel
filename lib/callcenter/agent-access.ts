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
  const [user, agent] = await Promise.all([
    adminDb.collection("users").doc(uid).get(), adminDb.collection("call_center_agents").doc(uid).get(),
  ]);
  const profiles = [user.exists && user.data()?.role === "call_center" ? mapAgentProfile(user.data() ?? {}) : null,
    agent.exists ? mapAgentProfile(agent.data() ?? {}) : null].filter((profile): profile is CallCenterAgentProfile => profile !== null);
  if (profiles.some((profile) => !profile.isActive)) return profiles.find((profile) => !profile.isActive)!;
  if (profiles.length) return profiles[0];
  // Never authorize a different UID merely because its profile has the same email.
  void email;
  return null;
}

function mapAgentProfile(data: Record<string, unknown>): CallCenterAgentProfile {
  const status = typeof data.status === "string" ? data.status : "active";
  const isActive =
    data.isActive !== false && status !== "inactive" && status !== "disabled" && status !== "suspended";

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
  if (!profile.isActive) {
    await adminAuth.updateUser(uid, { disabled: true });
    await adminAuth.setCustomUserClaims(uid, {});
    await adminAuth.revokeRefreshTokens(uid);
    return;
  }
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
  if (!profile.isActive) await ensureCallCenterAgentClaims(uid, profile);
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
