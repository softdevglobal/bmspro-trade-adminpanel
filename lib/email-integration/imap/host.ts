import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Owners can enter their own mail servers, so a hostname must never lead our
 * servers into a private network (cloud metadata, internal services). Every
 * connection resolves the name, refuses non-public addresses and connects to
 * the checked address (TLS still verifies the certificate for the name).
 */

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

/** True for addresses on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !PRIVATE.check(address, "ipv4");
  if (family !== 6) return false;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged by its IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !PRIVATE.check(mapped[1], "ipv4");
  return !PRIVATE.check(address, "ipv6");
}

export class UnsafeMailHostError extends Error {}

/**
 * Resolves a mail server name to a public address to connect to. Throws
 * UnsafeMailHostError when the name doesn't resolve or any answer is private.
 */
export async function resolvePublicMailHost(host: string): Promise<string> {
  // Local test mail servers, outside production builds only.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.EMAIL_ALLOW_PRIVATE_MAIL_HOSTS === "true"
  ) {
    return host;
  }
  if (isIP(host)) throw new UnsafeMailHostError("Use the server's name, not an IP address.");
  let answers: { address: string }[];
  try {
    answers = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeMailHostError(`${host} could not be found.`);
  }
  if (answers.length === 0 || !answers.every((answer) => isPublicAddress(answer.address))) {
    throw new UnsafeMailHostError(`${host} isn't a public mail server.`);
  }
  // Prefer IPv4: serverless networks often have no IPv6 route out.
  return (answers.find((answer) => isIP(answer.address) === 4) ?? answers[0]).address;
}
