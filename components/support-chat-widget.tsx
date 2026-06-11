"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  SUPPORT_CHAT_OPEN_EVENT,
  dispatchSupportChatPanelState,
} from "@/lib/supportChatEvents";
import {
  markAllCcRoomsRead,
  markCustomerConversationRead,
  sendUnifiedWorkshopChatMessage,
  subscribeUnifiedWorkshopChat,
  type UnifiedChatMessage,
  type UnifiedChatSnapshot,
  type UnifiedChatSubscription,
} from "@/lib/unifiedWorkshopChatClient";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

const WELCOME_MESSAGE: UnifiedChatMessage = {
  id: "welcome",
  source: "support",
  threadId: "",
  text: "👋 Hi! Messages with our reception team (queue + direct chats) appear here in one thread.",
  sender: "system",
  senderName: "Reception",
  timestamp: 0,
};

function formatMessageTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function mergeMessages(
  live: UnifiedChatMessage[],
  pending: UnifiedChatMessage[],
): UnifiedChatMessage[] {
  const confirmedIds = new Set(live.map((message) => message.id));
  const confirmedTexts = new Set(
    live
      .filter((message) => message.sender === "customer")
      .map((message) => message.text),
  );

  const stillPending = pending.filter((message) => {
    if (confirmedIds.has(message.id)) return false;
    if (message.id.startsWith("pending-") && confirmedTexts.has(message.text)) {
      return false;
    }
    return true;
  });

  return [...live, ...stillPending].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
}

export function SupportChatWidget() {
  const { user, role, status } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<UnifiedChatMessage[]>(
    [],
  );
  const [snapshot, setSnapshot] = useState<UnifiedChatSnapshot>({
    messages: [],
    unreadCount: 0,
    preferredCcChatId: null,
    supportConversationId: null,
    supportStatus: null,
    supportAgentName: null,
    ccAgentName: null,
    ccRoomIds: [],
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const subscriptionRef = useRef<UnifiedChatSubscription | null>(null);
  const eligible = status === "authenticated" && role === "business_owner";

  useEffect(() => {
    if (!eligible || !user) return;

    const subscription = subscribeUnifiedWorkshopChat(user.uid, {
      panelOpen: open,
      onUpdate: setSnapshot,
    });
    subscriptionRef.current = subscription;

    return () => {
      subscription.cleanup();
      subscriptionRef.current = null;
    };
  }, [eligible, user]);

  useEffect(() => {
    subscriptionRef.current?.setPanelOpen(open);
  }, [open]);

  useEffect(() => {
    function handleOpen() {
      setOpen(true);
    }
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, handleOpen);
    return () =>
      window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    dispatchSupportChatPanelState(open);
  }, [open]);

  useEffect(() => {
    if (!open || !user) return;

    void (async () => {
      if (snapshot.ccRoomIds.length > 0) {
        await markAllCcRoomsRead(snapshot.ccRoomIds);
      }
      if (snapshot.supportConversationId) {
        await markCustomerConversationRead(snapshot.supportConversationId);
      }
    })();
  }, [
    open,
    user,
    snapshot.ccRoomIds,
    snapshot.supportConversationId,
  ]);

  const displayMessages = useMemo(() => {
    const activeThreadId =
      snapshot.preferredCcChatId ?? snapshot.supportConversationId;
    const relevantPending = pendingMessages.filter((message) => {
      if (message.source === "cc") {
        return (
          !activeThreadId ||
          message.threadId === activeThreadId ||
          message.threadId === "pending"
        );
      }
      return (
        !snapshot.supportConversationId ||
        message.threadId === snapshot.supportConversationId ||
        message.threadId === "pending"
      );
    });
    const merged = mergeMessages(snapshot.messages, relevantPending);
    return merged.length > 0 ? merged : [WELCOME_MESSAGE];
  }, [
    snapshot.messages,
    snapshot.supportConversationId,
    snapshot.preferredCcChatId,
    pendingMessages,
  ]);

  useEffect(() => {
    setPendingMessages((current) =>
      current.filter((message) => {
        if (message.source === "cc") {
          return (
            !snapshot.preferredCcChatId ||
            message.threadId === snapshot.preferredCcChatId ||
            message.threadId === "pending"
          );
        }
        return (
          !snapshot.supportConversationId ||
          message.threadId === snapshot.supportConversationId ||
          message.threadId === "pending"
        );
      }),
    );
  }, [snapshot.supportConversationId, snapshot.preferredCcChatId]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, displayMessages]);

  const header = useMemo(() => {
    const agentName =
      snapshot.supportAgentName?.trim() ||
      snapshot.ccAgentName?.trim() ||
      null;

    if (snapshot.supportStatus === "connected" && agentName) {
      return {
        title: agentName,
        subtitle: `You are connected with ${agentName}`,
        dotClass: "bg-emerald-300",
      };
    }
    if (snapshot.supportStatus === "connected") {
      return {
        title: "Chat with receptionist",
        subtitle: "You are connected with an agent",
        dotClass: "bg-emerald-300",
      };
    }
    if (snapshot.supportStatus === "waiting") {
      return {
        title: "Waiting for an agent",
        subtitle: "Waiting for an agent...",
        dotClass: "bg-amber-300",
      };
    }
    if (agentName) {
      return {
        title: agentName,
        subtitle: "Call-center agent",
        dotClass: "bg-emerald-300",
      };
    }
    return {
      title: "Chat with receptionist",
      subtitle: "Message our reception team",
      dotClass: "bg-white/70",
    };
  }, [
    snapshot.supportStatus,
    snapshot.supportAgentName,
    snapshot.ccAgentName,
  ]);

  const handleSend = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = draft.trim();
      if (!text || sending) return;

      const pendingId = `pending-${Date.now()}`;
      const optimistic: UnifiedChatMessage = {
        id: pendingId,
        source: snapshot.preferredCcChatId ? "cc" : "support",
        threadId:
          snapshot.preferredCcChatId ??
          snapshot.supportConversationId ??
          "pending",
        text,
        sender: "customer",
        senderName: "You",
        timestamp: Date.now(),
      };

      setPendingMessages((current) => [...current, optimistic]);
      setDraft("");
      setSending(true);
      setError(null);

      try {
        const result = await sendUnifiedWorkshopChatMessage(
          text,
          snapshot.preferredCcChatId,
        );

        setPendingMessages((current) =>
          current.map((message) =>
            message.id === pendingId
              ? {
                  ...message,
                  id: result.messageId,
                  threadId: result.threadId,
                  source: result.source,
                }
              : message,
          ),
        );

        if (result.source === "support") {
          subscriptionRef.current?.ensureSupportThread(result.threadId);
        } else {
          subscriptionRef.current?.ensureCcThread(result.threadId);
        }
        await subscriptionRef.current?.refresh();
      } catch (sendError) {
        setPendingMessages((current) =>
          current.filter((message) => message.id !== pendingId),
        );
        setDraft(text);
        setError(
          sendError instanceof Error
            ? sendError.message
            : "Could not send message.",
        );
      } finally {
        setSending(false);
      }
    },
    [
      draft,
      sending,
      snapshot.preferredCcChatId,
      snapshot.supportConversationId,
    ],
  );

  if (!eligible) return null;

  const showBadge = !open && snapshot.unreadCount > 0;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open ? (
        <div
          className="pointer-events-auto flex h-[min(520px,calc(100dvh-6rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12141c] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]"
          role="dialog"
          aria-label="Chat with receptionist"
        >
          <header className="flex items-start gap-3 bg-primary-container px-4 py-4 text-on-primary">
            <span
              aria-hidden
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${header.dotClass}`}
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[18px] font-bold leading-tight">
                {header.title}
              </h2>
              <p className="mt-0.5 font-body text-[13px] text-on-primary/80">
                {header.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-primary transition-colors hover:bg-white/10"
              aria-label="Close chat"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col bg-[#12141c]">
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {displayMessages.map((message) => {
                const isCustomer = message.sender === "customer";
                const isSystem = message.sender === "system";
                const isPending = message.id.startsWith("pending-");
                const timeLabel = formatMessageTime(message.timestamp);

                if (isSystem) {
                  return (
                    <div key={`${message.source}-${message.id}`} className="flex justify-center">
                      <div className="max-w-[92%] rounded-2xl bg-[#232633]/80 px-4 py-2.5 text-center font-body text-[13px] leading-relaxed text-white/75">
                        {message.text}
                      </div>
                    </div>
                  );
                }

                const agentLabel =
                  message.senderName?.trim() ||
                  snapshot.supportAgentName?.trim() ||
                  "Reception";

                return (
                  <div
                    key={`${message.source}-${message.id}`}
                    className={`flex flex-col ${isCustomer ? "items-end" : "items-start"}`}
                  >
                    {!isCustomer ? (
                      <span className="mb-1 px-1 font-body text-[11px] text-white/45">
                        {agentLabel}
                      </span>
                    ) : null}
                    <div
                      className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 font-body text-[14px] leading-relaxed ${
                          isCustomer
                            ? "rounded-tr-md bg-primary-container text-on-primary"
                            : "rounded-tl-md bg-[#232633] text-white/90"
                        } ${isPending ? "opacity-80" : ""}`}
                      >
                        <p>{message.text}</p>
                        {timeLabel ? (
                          <p
                            className={`mt-1 text-[11px] ${
                              isCustomer ? "text-on-primary/70" : "text-white/45"
                            }`}
                          >
                            {timeLabel}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {error ? (
              <p className="px-4 pb-2 font-body text-[12px] text-error">
                {error}
              </p>
            ) : null}

            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t border-white/8 px-3 py-3"
            >
              <input
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type your message..."
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#1b1e28] px-4 py-3 font-body text-[14px] text-white placeholder:text-white/35 focus:border-primary-container focus:outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1e3a8a] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
              >
                <span className="material-symbols-outlined text-[20px]">
                  send
                </span>
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-[0_12px_28px_-6px_rgba(37,99,235,0.65)] transition-transform hover:scale-[1.03] active:scale-95"
        aria-label={open ? "Close chat" : "Open chat with receptionist"}
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[26px]">chat</span>
        {showBadge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 font-body text-[11px] font-bold text-on-error">
            {snapshot.unreadCount > 9 ? "9+" : snapshot.unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
