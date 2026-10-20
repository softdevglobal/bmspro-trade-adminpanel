const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";

/** Microsoft returns scopes with or without the Graph prefix, in any case. */
function graphScope(scope: string): string {
  return scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
}

/**
 * What the granted scopes allow. Sending always; reading with a mailbox
 * scope; organising (read/unread, star, archive, trash) only with a scope
 * that can change mail: Gmail's gmail.modify or Microsoft's Mail.ReadWrite.
 */
export function capabilitiesFromScopes(scopes: string[]): string[] {
  const graph = new Set(scopes.map(graphScope));
  if (scopes.includes(GMAIL_MODIFY) || graph.has("mail.readwrite")) {
    return ["send", "read", "modify"];
  }
  if (scopes.includes(GMAIL_READONLY) || graph.has("mail.read")) return ["send", "read"];
  return ["send"];
}
