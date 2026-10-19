const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";

/**
 * What the granted Google scopes allow. Sending always; reading with either
 * mailbox scope; label actions (read/unread, star, archive, trash) only with
 * gmail.modify.
 */
export function capabilitiesFromScopes(scopes: string[]): string[] {
  if (scopes.includes(MODIFY)) return ["send", "read", "modify"];
  if (scopes.includes(READONLY)) return ["send", "read"];
  return ["send"];
}
