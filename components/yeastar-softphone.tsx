"use client";

import { Phone, PhoneIncoming, Delete, Minus, Power } from "lucide-react";
import { useRightDrawerInset } from "@/lib/ui/right-drawer-slot";
import type { CSSProperties } from "react";
import { CallerCustomerDrawer } from "@/components/caller-customer-drawer";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallStatus, PhoneOperator } from "ys-webrtc-sdk-core";

type PhoneState = "disconnected" | "connecting" | "registered" | "error";
type CallInfo = {
  id: string;
  number: string;
  name: string;
  direction: "inbound" | "outbound";
  status: string;
  muted: boolean;
};
type CustomerMatch = { uid: string; fullName: string; email: string; phone: string };

function phoneMatchKey(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0061")) digits = digits.slice(2);
  if (digits.startsWith("61") && digits.length >= 10) digits = `0${digits.slice(2)}`;
  return digits;
}

function callInfo(status: CallStatus): CallInfo {
  return {
    id: status.callId,
    number: status.number,
    name: status.name,
    direction: status.communicationType,
    status: status.callStatus,
    muted: status.isMute,
  };
}

export function YeastarSoftphone() {
  const { user, role, status: authStatus } = useAuth();
  const drawerInset = useRightDrawerInset();
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerMatch | null>(null);
  const closeCustomer = useCallback(() => setSelectedCustomer(null), []);
  const [open, setOpen] = useState(false);
  const [phoneState, setPhoneState] = useState<PhoneState>("disconnected");
  const [error, setError] = useState("");
  const [dialNumber, setDialNumber] = useState("");
  const [calls, setCalls] = useState<CallInfo[]>([]);
  const [customerMatches, setCustomerMatches] = useState<Record<string, CustomerMatch | null | "loading" | "error">>({});
  const customersRef = useRef<CustomerMatch[] | null>(null);
  const answeringRef = useRef(new Set<string>());
  const [incomingIds, setIncomingIds] = useState<string[]>([]);
  const [answeringIds, setAnsweringIds] = useState<string[]>([]);
  const phoneRef = useRef<PhoneOperator | null>(null);
  const connectionGeneration = useRef(0);
  const autoConnectedUser = useRef<string | null>(null);
  const destroyRef = useRef<(() => void) | null>(null);
  const activeSessionsRef = useRef(new Map<string, CallStatus>());

  const updateCall = useCallback((status: CallStatus) => {
    activeSessionsRef.current.set(status.callId, status);
    if (status.callStatus === "talking") setIncomingIds((ids) => ids.filter((id) => id !== status.callId));
    setCalls(Array.from(activeSessionsRef.current.values(), callInfo));
  }, []);

  const removeCall = useCallback((id: string) => {
    activeSessionsRef.current.delete(id);
    setIncomingIds((ids) => ids.filter((value) => value !== id));
    setCalls(Array.from(activeSessionsRef.current.values(), callInfo));
    setCustomerMatches((matches) => {
      const next = { ...matches };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    const pending = calls.filter((call) => incomingIds.includes(call.id) && customerMatches[call.id] === undefined && call.number.trim());
    if (!pending.length || !user) return;
    const generation = connectionGeneration.current;
    const lookup = async () => {
      for (const call of pending) setCustomerMatches((current) => ({ ...current, [call.id]: "loading" }));
      try {
        if (!customersRef.current) {
          const token = await user.getIdToken();
          const response = await fetch("/api/customers", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          const data = await response.json() as { ok?: boolean; customers?: CustomerMatch[] };
          if (!response.ok || !data.ok) throw new Error("Customer lookup failed");
          customersRef.current = data.customers ?? [];
        }
        if (generation !== connectionGeneration.current) return;
        for (const call of pending) {
          if (!activeSessionsRef.current.has(call.id)) continue;
          const key = phoneMatchKey(call.number);
          const matches = customersRef.current.filter((customer) => key && phoneMatchKey(customer.phone) === key);
          setCustomerMatches((current) => ({ ...current, [call.id]: matches.length === 1 ? matches[0] : null }));
        }
      } catch {
        if (generation === connectionGeneration.current) for (const call of pending.filter(call => activeSessionsRef.current.has(call.id))) setCustomerMatches((current) => ({ ...current, [call.id]: "error" }));
      }
    };
    void lookup();

  }, [calls, incomingIds, customerMatches, user]);

  const disconnect = useCallback(() => {
    connectionGeneration.current += 1;
    const destroy = destroyRef.current;
    phoneRef.current = null;
    destroy?.();
    destroyRef.current = null;
    phoneRef.current = null;
    activeSessionsRef.current.clear();
    setCalls([]);
    setIncomingIds([]);
    setAnsweringIds([]);
    answeringRef.current.clear();
    setPhoneState("disconnected");
    const audio = document.getElementById("trade-yeastar-remote-audio") as HTMLAudioElement | null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
  }, []);

  useEffect(() => () => {
    connectionGeneration.current += 1;
    autoConnectedUser.current = null;
    destroyRef.current?.();
    destroyRef.current = null;
    phoneRef.current = null;
    const audio = document.getElementById("trade-yeastar-remote-audio") as HTMLAudioElement | null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
  }, []);

  useEffect(() => {
    const retryAudio = () => {
      const audio = document.getElementById("trade-yeastar-remote-audio") as HTMLAudioElement | null;
      if (audio?.srcObject && audio.paused) void audio.play().catch(() => {});
    };
    document.addEventListener("pointerdown", retryAudio);
    document.addEventListener("keydown", retryAudio);
    return () => {
      document.removeEventListener("pointerdown", retryAudio);
      document.removeEventListener("keydown", retryAudio);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!user) return;
    disconnect();
    const generation = connectionGeneration.current;
    setPhoneState("connecting");
    setError("");
    try {
      // The browser prompts once if microphone access has not been granted.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (generation !== connectionGeneration.current) return;

      const token = await user.getIdToken();
      const response = await fetch("/api/integrations/yeastar/sign", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        sign?: string;
        pbxUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.sign || !data.pbxUrl) {
        throw new Error(data.error || "Could not get a secure Yeastar signature.");
      }

      if (generation !== connectionGeneration.current) return;
      const { init } = await import("ys-webrtc-sdk-core");
      if (generation !== connectionGeneration.current) return;
      const operator = await init({
        username: user.email ?? "",
        secret: data.sign,
        pbxURL: data.pbxUrl,
        enableLog: false,
      });
      if (generation !== connectionGeneration.current) { operator.destroy(); return; }
      phoneRef.current = operator.phone;
      destroyRef.current = operator.destroy;

      operator.phone.on("registered", () => setPhoneState("registered"));
      operator.phone.on("registrationFailed", () => {
        setPhoneState("error");
        setError("Yeastar could not register this extension. Check that Linkus is enabled for your account.");
      });
      operator.phone.on("disconnected", () => {
        if (phoneRef.current !== operator.phone) return;
        setPhoneState("error");
        setError("The Yeastar signaling connection closed. Check your network and other Linkus sessions, then retry.");
      });
      operator.phone.on("isRegisteredChange", (registered: boolean) => {
        if (registered) setPhoneState("registered");
        else if (phoneRef.current === operator.phone) setPhoneState("error");
      });
      operator.phone.on("newRTCSession", ({ callId, session }: { callId: string; session: { status: CallStatus; on: (event: string, callback: () => void) => void; remoteStream: MediaStream } }) => {
        updateCall(session.status);
        const attachAudio = (payload?: unknown) => {
          const stream = payload instanceof MediaStream
            ? payload
            : payload && typeof payload === "object" && "stream" in payload
              ? (payload as { stream: unknown }).stream
              : null;
          // Yeastar also emits empty payloads while tearing down failed calls.
          if (!(stream instanceof MediaStream)) return;
          let audio = document.getElementById("trade-yeastar-remote-audio") as HTMLAudioElement | null;
          if (!audio) {
            audio = document.createElement("audio");
            audio.id = "trade-yeastar-remote-audio";
            audio.autoplay = true;
            audio.setAttribute("playsinline", "true");
            audio.style.display = "none";
            document.body.appendChild(audio);
          }
          audio.srcObject = stream;
          void audio.play().catch(() => { /* Retried on the next user interaction. */ });
        };
        attachAudio(session.remoteStream);
        session.on("statusChange", () => {
          updateCall(session.status);
          attachAudio(session.remoteStream);
        });
        session.on("streamAdded", attachAudio);
        session.on("updateRemoteStream", attachAudio);
        session.on("ended", () => removeCall(callId));
        session.on("failed", () => removeCall(callId));
      });
      operator.phone.on("incoming", ({ callId }: { callId: string }) => {
        setIncomingIds((ids) => ids.includes(callId) ? ids : [...ids, callId]);
      });
      operator.phone.on("startSession", ({ callId }: { callId: string }) => {
        const session = operator.phone.getSession(callId);
        if (session?.status.callStatus === "talking") {
          setIncomingIds((ids) => ids.filter((id) => id !== callId));
        }
      });
      operator.phone.on("deleteSession", ({ callId }: { callId: string }) => removeCall(callId));
      operator.pbx.on("runtimeError", (result) => {
        const details = result as unknown as { code?: number; message?: string };
        setError(`Yeastar error ${details.code ?? ""}: ${details.message ?? "A PBX error occurred."}`);
      });
      operator.phone.start();
    } catch (err) {
      if (generation !== connectionGeneration.current) return;
      disconnect();
      setPhoneState("error");
      setError(err instanceof Error ? err.message : "Could not connect to Yeastar.");
    }
  }, [user, disconnect, updateCall, removeCall]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user || (role !== "business_owner" && role !== "staff")) {
      if (autoConnectedUser.current) disconnect();
      autoConnectedUser.current = null;
      return;
    }
    if (autoConnectedUser.current === user.uid) return;
    autoConnectedUser.current = user.uid;
    void connect();
  }, [authStatus, user, role, connect, disconnect]);

  const makeCall = async () => {
    const number = dialNumber.trim();
    if (!number || !phoneRef.current) return;
    if (!/^[+\d*#().\s-]{2,40}$/.test(number)) {
      setError("Enter a valid phone number or extension.");
      return;
    }
    setError("");
    try {
      await phoneRef.current.call(number);
      setDialNumber("");
    } catch {
      setError("Call could not be started. Check the number and try again.");
    }
  };

  const endCall = (call: CallInfo) => {
    const phone = phoneRef.current;
    try {
      if (phone?.getSession(call.id)) {
        if (call.direction === "inbound" && call.status !== "talking") {
          phone.reject(call.id);
        } else {
          phone.hangup(call.id);
        }
      }
    } catch {
      // The remote party can terminate before the SDK removes its session.
    } finally {
      removeCall(call.id);
    }
  };

  const answerCall = async (id: string) => {
    const phone = phoneRef.current;
    const session = phone?.getSession(id);
    if (!phone || !session) { removeCall(id); return; }
    if (answeringRef.current.has(id) || session.status.callStatus === "talking") return;
    answeringRef.current.add(id);
    setAnsweringIds((ids) => [...ids, id]);
    try {
      setError("");
      await phone.answer(id);
      setIncomingIds((ids) => ids.filter((value) => value !== id));
    } catch {
      setError("This call could not be answered. It may have ended or been answered elsewhere.");
      if (!phone.getSession(id)) removeCall(id);
    } finally {
      answeringRef.current.delete(id);
      setAnsweringIds((ids) => ids.filter((value) => value !== id));
    }
  };

  const ringingCall = calls.find((call) => incomingIds.includes(call.id) && call.status !== "talking");
  const ringing = incomingIds.length > 0;
  const pressDigit = (digit: string) => {
    const connected = calls.find((call) => call.status === "talking");
    if (connected) {
      try { phoneRef.current?.dtmf(connected.id, digit); }
      catch { setError("Could not send the keypad tone. Try again."); }
    }
    setDialNumber((number) => number + digit);
  };

  if (authStatus !== "authenticated" || (role !== "business_owner" && role !== "staff")) return null;

  return (
    <div style={{ "--caller-drawer-inset": `${drawerInset}px` } as CSSProperties} className={`fixed transition-[right] duration-300 motion-reduce:transition-none ${drawerInset ? "z-[90] lg:right-[calc(var(--caller-drawer-inset)+24px)]" : "z-[60]"} w-[min(360px,calc(100vw-2rem))] ${role === "business_owner" ? "bottom-[84px] right-4 sm:bottom-[92px] sm:right-6" : "bottom-4 right-4 sm:bottom-6 sm:right-6"}`}>
      {selectedCustomer ? <CallerCustomerDrawer key={selectedCustomer.uid} customer={selectedCustomer} onClose={closeCustomer} /> : null}
      {open ? (
        <section className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-3xl border border-outline-variant bg-surface shadow-[0_20px_60px_rgba(15,23,42,.24)]" aria-label="Yeastar softphone">
          <header className="flex items-center justify-between bg-primary px-4 py-3 text-white">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold"><Phone className={`h-4 w-4 ${ringing ? "yeastar-phone-ringing" : ""}`} /> Yeastar phone</p>
              <p className="text-xs text-white/80">{phoneState === "registered" ? "Connected" : phoneState === "connecting" ? "Connecting-" : phoneState === "error" ? "Needs attention" : "Disconnected"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm hover:bg-white/15" aria-label="Minimize phone"><Minus className="h-5 w-5" /></button>
          </header>
          <div className="space-y-3 p-4">
            {phoneState !== "registered" ? (
              <button type="button" onClick={() => void connect()} disabled={phoneState === "connecting"} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {phoneState === "connecting" ? "Connecting-" : phoneState === "error" ? "Retry connection" : "Connect phone"}
              </button>
            ) : (
              <>
                <form onSubmit={(event) => { event.preventDefault(); void makeCall(); }} className="space-y-3">
                  <div className="flex items-center rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-2 focus-within:border-primary">
                    <input value={dialNumber} onChange={(event) => setDialNumber(event.target.value)} inputMode="tel" autoComplete="off" placeholder="Number or extension" aria-label="Phone number" className="min-w-0 flex-1 bg-transparent py-2 text-center text-xl font-semibold tracking-wide outline-none placeholder:text-sm placeholder:font-normal placeholder:tracking-normal" />
                    <button type="button" onClick={() => setDialNumber((number) => number.slice(0, -1))} aria-label="Delete last digit" className="rounded-lg p-2 text-on-surface-variant hover:bg-surface"><Delete className="h-5 w-5" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]].map(([digit, letters]) => (
                      <button key={digit} type="button" onClick={() => pressDigit(digit)} aria-label={`Dial ${digit}`} className="flex h-14 flex-col items-center justify-center rounded-2xl bg-surface-container-low transition-colors hover:bg-primary/10 active:bg-primary/20">
                        <span className="text-2xl font-medium leading-7">{digit}</span><span className="h-3 text-[9px] font-semibold tracking-[.2em] text-on-surface-variant">{letters}</span>
                      </button>
                    ))}
                  </div>
                  <button type="submit" disabled={!dialNumber.trim() || ringing} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-40"><Phone className="h-5 w-5" /> Call</button>
                </form>
                {calls.map((call) => (
                  <div key={call.id} className={`rounded-2xl border p-4 ${incomingIds.includes(call.id) ? "border-emerald-200 bg-emerald-50 yeastar-phone-ringing" : "border-outline-variant bg-surface-container-low"}`}>
                    <p className="text-sm font-semibold">{call.name || call.number || "Call"}</p>
                    <p className="text-xs text-on-surface-variant">{call.direction === "inbound" ? "Incoming" : "Outgoing"} - {call.status}</p>
                    {incomingIds.includes(call.id) ? (
                      <div className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-xs">
                        {customerMatches[call.id] === "loading" || customerMatches[call.id] === undefined ? <p className="text-on-surface-variant">Looking up customer...</p> : null}
                        {customerMatches[call.id] === "error" ? <p className="text-amber-700">Customer details unavailable</p> : null}
                        {customerMatches[call.id] === null ? <><p className="font-semibold text-amber-700">New caller</p><p className="mt-0.5 text-on-surface-variant">No customer found for this number</p></> : null}
                        {customerMatches[call.id] && customerMatches[call.id] !== "loading" && customerMatches[call.id] !== "error" ? <><p className="font-semibold text-emerald-700">Existing customer</p><p className="mt-0.5 font-semibold"><button type="button" className="text-primary underline underline-offset-2" onClick={() => setSelectedCustomer(customerMatches[call.id] as CustomerMatch)}>{(customerMatches[call.id] as CustomerMatch).fullName} - View bookings</button></p><p className="text-on-surface-variant">{(customerMatches[call.id] as CustomerMatch).email || (customerMatches[call.id] as CustomerMatch).phone}</p></> : null}
                      </div>
                    ) : null}
                    <div className="mt-3 flex gap-2">
                      {incomingIds.includes(call.id) && call.status !== "talking" ? <button type="button" disabled={answeringIds.includes(call.id)} onClick={() => void answerCall(call.id)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{answeringIds.includes(call.id) ? "Answering..." : "Answer"}</button> : null}
                      {call.status === "talking" ? <button type="button" onClick={() => { const phone = phoneRef.current; if (!phone) return; if (call.muted) phone.unmute(call.id); else phone.mute(call.id); }} className="rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold">{call.muted ? "Unmute" : "Mute"}</button> : null}
                      <button type="button" onClick={() => endCall(call)} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white">{call.direction === "inbound" && call.status !== "talking" ? "Reject" : "Hang up"}</button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={disconnect} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-low"><Power className="h-3.5 w-3.5" /> Disconnect</button>
              </>
            )}
            {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
          </div>
        </section>
      ) : (
        <div className="flex items-center justify-end gap-3">
          {ringing ? <button type="button" onClick={() => setOpen(true)} role="status" aria-live="polite" className="max-w-[240px] rounded-2xl border border-emerald-200 bg-surface px-4 py-3 text-left shadow-lg"><span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-600">Incoming call</span><span className="block truncate text-sm font-semibold">{ringingCall?.number || "Unknown number"}</span>{ringingCall?.name ? <span className="block truncate text-xs text-on-surface-variant">{ringingCall.name}</span> : null}</button> : null}
          <button type="button" onClick={() => setOpen(true)} aria-label={ringing ? `Answer incoming call from ${ringingCall?.number || "unknown number"}` : "Open phone dial pad"} aria-expanded={open} className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-colors ${ringing ? "bg-emerald-600 yeastar-phone-ringing" : "bg-primary hover:bg-primary/90"}`}>
            {ringing ? <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-400/40 motion-safe:animate-ping" /> : null}
            {ringing ? <PhoneIncoming className="relative h-6 w-6" /> : <Phone className="h-6 w-6" />}
            <span className={`absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-surface ${phoneState === "registered" ? "bg-emerald-400" : phoneState === "error" ? "bg-rose-400" : "bg-slate-400"}`} />
          </button>
        </div>
      )}
    </div>
  );
}

