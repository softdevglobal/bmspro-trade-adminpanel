/** Copy plain text to the clipboard, with a prompt fallback when blocked. */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copy this text:", text);
  }
}
