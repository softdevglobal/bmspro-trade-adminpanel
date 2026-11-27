/**
 * Who sent this email? (docs/sophie-email-learning-and-auto-reply.md §9.2)
 *
 * Decided by code from the customer records and the headers, never by the AI. A matching From
 * address is a contact match, not proof: it can be faked, and one address can be shared by a
 * family or an office. Pure functions; the caller loads the records and the headers.
 *
 * Only the sender's own address is ever looked up. Nothing here reads the email's text, so a name
 * written in the email ("please check Mary Brown's invoice") can never lead to her records (T24).
 */

import { extractAddresses, parseSender } from "@/lib/email-integration/mailbox/parse";
import type { EmailProvider } from "@/lib/email-integration/types";

export type SenderIdentity = "none" | "contact_match" | "verified_sender" | "verified_thread";

/** From the top Authentication-Results line, for the From address's domain. */
export type AuthResult = "pass" | "fail" | "missing";

/** Why the sender isn't verified (or isn't a customer at all). */
export type IdentityReason =
  | "not_on_record"
  | "auth_missing"
  | "auth_failed"
  | "reply_to_differs"
  | "shared_address"
  | "forwarded";

export type IdentityResult = {
  level: SenderIdentity;
  /** The From address, lowercased; null when it isn't one valid address. */
  senderAddress: string | null;
  /** Set only when the address belongs to exactly one customer name. */
  customerName: string | null;
  auth: AuthResult;
  reasons: IdentityReason[];
  /** Any reply goes here: the From address, which for a customer is the address on record. Never Reply-To (T23). */
  replyAddress: string | null;
  /** People on the email other than the business and this customer. While there are any, private details stay out (T22). */
  otherRecipients: string[];
};

const SINGLE_ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

// ---- Authentication-Results (RFC 8601) ------------------------------------------------

type AuthMethodResult = { method: string; result: string; props: Record<string, string> };
export type ParsedAuthResults = { authservId: string | null; results: AuthMethodResult[] };

function stripComments(value: string): string {
  let text = value;
  for (let i = 0; i < 3 && /\([^()]*\)/.test(text); i++) text = text.replace(/\([^()]*\)/g, " ");
  return text;
}

export function parseAuthenticationResults(value: string): ParsedAuthResults {
  const parts = stripComments(value).split(";").map((part) => part.trim()).filter(Boolean);
  let authservId: string | null = null;
  // The first part is the server's name, unless the server left it out (Microsoft does).
  if (parts.length > 0 && !/^[a-z0-9.-]+\s*=/i.test(parts[0])) {
    authservId = parts.shift()!.split(/\s+/)[0].toLowerCase() || null;
  }
  const results = parts.flatMap((part): AuthMethodResult[] => {
    const [head, ...rest] = part.split(/\s+/);
    const match = /^([a-z0-9-]+)=([a-z0-9_-]+)$/i.exec(head ?? "");
    if (!match) return [];
    const props: Record<string, string> = {};
    for (const token of rest) {
      const equals = token.indexOf("=");
      if (equals > 0) props[token.slice(0, equals).toLowerCase()] = token.slice(equals + 1).replace(/^"|"$/g, "").toLowerCase();
    }
    return [{ method: match[1].toLowerCase(), result: match[2].toLowerCase(), props }];
  });
  return { authservId, results };
}

/**
 * The provider's own authserv-id. A line from anyone else may have been written by the sender,
 * so it counts as missing. Other IMAP hosts vary too much to trust yet: they fail closed.
 */
export function isTrustedAuthServer(provider: EmailProvider, authservId: string | null): boolean {
  switch (provider) {
    case "google":
      return authservId === "mx.google.com";
    case "microsoft":
      // Exchange Online stamps its line without a name; mail from inside the tenant has none at all.
      return authservId === null || /(^|\.)(outlook\.com|office365\.com)$/.test(authservId);
    case "yahoo":
      return authservId !== null && /(^|\.)yahoo\.com$/.test(authservId);
    case "imap":
      return false;
  }
}

const domainOf = (address: string) => address.split("@")[1] ?? "";
/** Relaxed DMARC alignment: the same domain, or the From domain is a subdomain of the signer's. */
const aligned = (signer: string, fromDomain: string) =>
  Boolean(signer) && (signer === fromDomain || fromDomain.endsWith(`.${signer}`));

/**
 * Passes on `dmarc=pass` for the From domain. When the domain has no DMARC policy, passes on a
 * DKIM signature aligned with the From domain. Anything else, or an untrusted line, does not.
 */
export function checkSenderAuthentication(input: {
  provider: EmailProvider;
  /** TriageHeaders.authenticationResults: the top line only. */
  authenticationResults: string | null;
  fromAddress: string | null;
}): AuthResult {
  if (!input.authenticationResults) return "missing";
  const parsed = parseAuthenticationResults(input.authenticationResults);
  if (!isTrustedAuthServer(input.provider, parsed.authservId)) return "missing";
  const fromDomain = input.fromAddress ? domainOf(input.fromAddress) : "";
  if (!fromDomain) return "fail";

  const dmarc = parsed.results.find((result) => result.method === "dmarc");
  if (dmarc?.result === "pass") {
    const headerFrom = dmarc.props["header.from"];
    return !headerFrom || headerFrom === fromDomain ? "pass" : "fail";
  }
  // "none" and Microsoft's "bestguesspass" mean the domain publishes no DMARC policy.
  if (dmarc && dmarc.result !== "none" && dmarc.result !== "bestguesspass") return "fail";
  const dkimAligned = parsed.results.some((result) => {
    if (result.method !== "dkim" || result.result !== "pass") return false;
    const signer = result.props["header.d"] ?? result.props["header.i"]?.split("@").pop() ?? "";
    return aligned(signer, fromDomain);
  });
  return dkimAligned ? "pass" : "fail";
}

// ---- Identity level --------------------------------------------------------------------

export type IdentityInput = {
  /** Raw From, To and Cc header text, and the subject. */
  from: string;
  to: string;
  cc: string;
  subject: string;
  /** The connected mailbox's address. */
  ownAddress: string;
  /** TriageHeaders.replyTo. */
  replyTo: string[];
  auth: AuthResult;
  /** Customer email (lowercase) -> the distinct names on records with it (BusinessMailContext.customers). */
  customers: Map<string, Set<string>>;
  /** When the platform started this thread (a quote or invoice email): the addresses it went to. */
  platformThreadRecipients: string[] | null;
};

const FORWARDED = /^\s*(fwd?|fw)\s*:/i;

export function senderIdentity(input: IdentityInput): IdentityResult {
  const own = input.ownAddress.trim().toLowerCase();
  // The address inside <…>, not one written in the display name ("support@bank.example <x@evil.example>").
  const parsed = parseSender(input.from).address;
  const senderAddress = SINGLE_ADDRESS.test(parsed) ? parsed : null;
  const names = senderAddress && senderAddress !== own ? input.customers.get(senderAddress) : undefined;
  const customerName = names?.size === 1 ? [...names][0] : null;

  const sameCustomer = (address: string) => {
    if (address === senderAddress) return true;
    const other = input.customers.get(address);
    return customerName !== null && other?.size === 1 && other.has(customerName);
  };
  const otherRecipients = extractAddresses(input.to, input.cc)
    .filter((address) => address !== own && !sameCustomer(address));

  const result = (level: SenderIdentity, reasons: IdentityReason[]): IdentityResult => ({
    level, senderAddress, customerName, auth: input.auth, reasons, replyAddress: senderAddress, otherRecipients,
  });

  if (!senderAddress || !names) return result("none", ["not_on_record"]);

  const reasons: IdentityReason[] = [];
  if (input.auth === "missing") reasons.push("auth_missing");
  if (input.auth === "fail") reasons.push("auth_failed");
  if (input.replyTo.some((address) => address !== senderAddress)) reasons.push("reply_to_differs");
  if (names.size !== 1) reasons.push("shared_address");
  if (FORWARDED.test(input.subject)) reasons.push("forwarded");
  if (reasons.length > 0) return result("contact_match", reasons);

  const platformSentHere = input.platformThreadRecipients?.some((address) => address.trim().toLowerCase() === senderAddress);
  return result(platformSentHere ? "verified_thread" : "verified_sender", []);
}

/**
 * Tier T1 (their own booking details, §9.3) may go into a reply only for a verified sender, only to
 * the address on record, and only while nobody else is on the email.
 */
export function mayShareOwnDetails(identity: IdentityResult): boolean {
  return (identity.level === "verified_sender" || identity.level === "verified_thread")
    && identity.otherRecipients.length === 0;
}
