import "server-only";

import { randomBytes } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { getStripe } from "@/lib/stripe/client";
import {
  getAppBaseUrl,
  getStripeConnectClientId,
  isStripeConnectConfigured,
} from "@/lib/stripe/config";

const OAUTH_STATE_COLLECTION = "stripe_oauth_states";
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export type BusinessConnectAccount = {
  accountId: string | null;
  onboarded: boolean;
};

/** Redirect URI that must be registered in the Stripe Connect OAuth settings. */
export function getConnectRedirectUri(): string {
  return `${getAppBaseUrl()}/api/stripe/connect/callback`;
}

/** Reads the connected-account state stored on a business document. */
export async function getBusinessConnectAccount(
  businessId: string,
): Promise<BusinessConnectAccount> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  const data = snap.data() ?? {};
  return {
    accountId:
      typeof data.stripeConnectAccountId === "string" &&
      data.stripeConnectAccountId.trim()
        ? data.stripeConnectAccountId.trim()
        : null,
    onboarded: data.stripeConnectOnboarded === true,
  };
}

/**
 * Creates a short-lived, single-use CSRF state token tied to the business so
 * the (unauthenticated) OAuth callback can resolve who is connecting.
 */
async function createOAuthState(businessId: string): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await adminDb.collection(OAUTH_STATE_COLLECTION).doc(state).set({
    businessId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return state;
}

/** Verifies and consumes an OAuth state token, returning its business id. */
export async function consumeOAuthState(
  state: string,
): Promise<string | null> {
  const trimmed = state.trim();
  if (!trimmed) return null;

  const ref = adminDb.collection(OAUTH_STATE_COLLECTION).doc(trimmed);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  await ref.delete().catch(() => {});

  const createdAt =
    data.createdAt && typeof data.createdAt.toMillis === "function"
      ? data.createdAt.toMillis()
      : 0;
  if (createdAt && Date.now() - createdAt > OAUTH_STATE_TTL_MS) {
    return null;
  }

  return typeof data.businessId === "string" && data.businessId.trim()
    ? data.businessId.trim()
    : null;
}

/** Builds the Stripe Standard OAuth authorize URL for a business to connect. */
export async function buildConnectAuthorizeUrl(input: {
  businessId: string;
  businessName?: string | null;
  ownerEmail?: string | null;
}): Promise<string> {
  const clientId = getStripeConnectClientId();
  if (!clientId) {
    throw new Error(
      "Stripe Connect is not configured. Set STRIPE_CLIENT_ID in .env.local.",
    );
  }

  const stripe = getStripe();
  const state = await createOAuthState(input.businessId);

  return stripe.oauth.authorizeUrl({
    client_id: clientId,
    response_type: "code",
    scope: "read_write",
    redirect_uri: getConnectRedirectUri(),
    state,
    stripe_landing: "login",
    ...(input.businessName || input.ownerEmail
      ? {
          stripe_user: {
            ...(input.businessName
              ? { business_name: input.businessName }
              : {}),
            ...(input.ownerEmail ? { email: input.ownerEmail } : {}),
            country: "AU",
          },
        }
      : {}),
  });
}

/** Exchanges an OAuth authorization code for the connected Stripe account id. */
export async function exchangeConnectAuthorizationCode(
  code: string,
): Promise<string> {
  const stripe = getStripe();
  const token = await stripe.oauth.token({
    grant_type: "authorization_code",
    code,
  });
  const accountId = token.stripe_user_id?.trim();
  if (!accountId) {
    throw new Error("Stripe did not return a connected account id.");
  }
  return accountId;
}

/** Reads whether a connected account can accept charges yet. */
async function accountChargesEnabled(accountId: string): Promise<boolean> {
  try {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(accountId);
    return Boolean(account.charges_enabled);
  } catch (error) {
    console.error("[stripe connect] account retrieve failed:", error);
    return false;
  }
}

/** Persists the connected account id (and onboarding state) on the business. */
export async function saveBusinessConnectAccount(
  businessId: string,
  accountId: string,
): Promise<BusinessConnectAccount> {
  const onboarded = await accountChargesEnabled(accountId);
  await adminDb.collection("businesses").doc(businessId).set(
    {
      stripeConnectAccountId: accountId,
      stripeConnectOnboarded: onboarded,
      stripeConnectConnectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { accountId, onboarded };
}

/**
 * Flips a business's onboarding flag to true for a connected account (used by
 * the `account.updated` webhook once charges become enabled).
 */
export async function markConnectAccountOnboarded(
  accountId: string,
): Promise<void> {
  const snap = await adminDb
    .collection("businesses")
    .where("stripeConnectAccountId", "==", accountId)
    .limit(1)
    .get();
  if (snap.empty) return;
  await snap.docs[0].ref.set(
    {
      stripeConnectOnboarded: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Disconnects a business's Stripe account (deauthorize + clear fields). */
export async function disconnectBusinessConnectAccount(
  businessId: string,
): Promise<void> {
  const { accountId } = await getBusinessConnectAccount(businessId);
  const clientId = getStripeConnectClientId();

  if (accountId && clientId && isStripeConnectConfigured()) {
    try {
      const stripe = getStripe();
      await stripe.oauth.deauthorize({
        client_id: clientId,
        stripe_user_id: accountId,
      });
    } catch (error) {
      console.error("[stripe connect] deauthorize failed:", error);
    }
  }

  await adminDb.collection("businesses").doc(businessId).set(
    {
      stripeConnectAccountId: FieldValue.delete(),
      stripeConnectOnboarded: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
