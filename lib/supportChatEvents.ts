export const SUPPORT_CHAT_OPEN_EVENT = "bms-open-support-chat";
export const SUPPORT_CHAT_PANEL_STATE_EVENT = "bms-support-chat-panel-state";

export function openSupportChatWidget(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SUPPORT_CHAT_OPEN_EVENT));
}

export function dispatchSupportChatPanelState(open: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SUPPORT_CHAT_PANEL_STATE_EVENT, { detail: { open } }),
  );
}
