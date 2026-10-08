"use client";
import { useRef, useState, type PointerEvent } from "react";
import { parseSignature, type SignaturePoint, type SignatureStrokes } from "@/lib/participant-onboarding/signature";

export function OnboardingSignaturePad({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [drawing, setDrawing] = useState<SignatureStrokes | null>(null);
  const pending = useRef<SignatureStrokes | null>(null);
  const pointer = useRef<number | null>(null);
  const strokes = drawing ?? parseSignature(value);
  function point(event: PointerEvent<SVGSVGElement>): SignaturePoint {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(1000, (event.clientX - box.left) / box.width * 1000))), Math.round(Math.max(0, Math.min(1000, (event.clientY - box.top) / box.height * 1000)))];
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) onChange(JSON.stringify(next));
    setDrawing(null);
  }
  return <div className="space-y-2">
    <p className="text-sm text-on-surface-variant">Draw your signature below using a mouse, finger or stylus. Save the onboarding form to keep it.</p>
    <svg role="img" aria-label="Participant signature drawing area" viewBox="0 0 1000 1000" preserveAspectRatio="none" className="h-48 w-full touch-none rounded-xl border border-outline-variant/60 bg-white text-slate-900" style={{ cursor: disabled ? "default" : "crosshair" }}
      onPointerDown={(event) => {
        if (disabled || pointer.current !== null || (event.pointerType === "mouse" && event.button !== 0) || strokes.length >= 100 || strokes.flat().length >= 1500) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
        pending.current = [...strokes, [point(event)]]; setDrawing(pending.current);
      }}
      onPointerMove={(event) => {
        if (pointer.current !== event.pointerId || !pending.current || pending.current.flat().length >= 1500) return;
        const nextPoint = point(event);
        const last = pending.current.at(-1)!;
        const previous = last.at(-1)!;
        if (Math.abs(previous[0] - nextPoint[0]) + Math.abs(previous[1] - nextPoint[1]) < 3) return;
        pending.current = [...pending.current.slice(0, -1), [...last, nextPoint]]; setDrawing(pending.current);
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      {strokes.map((stroke, index) => <polyline key={index} points={(stroke.length === 1 ? [stroke[0], [stroke[0][0] + 0.1, stroke[0][1] + 0.1]] : stroke).map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    <div className="flex items-center gap-3"><button type="button" disabled={disabled || !value || drawing !== null} className="min-h-11 rounded-xl border border-outline-variant/60 px-4 py-2 font-body text-[13px] font-semibold hover:bg-primary/5 disabled:opacity-50" onClick={() => { if (window.confirm("Clear the participant signature?")) onChange(""); }}>Clear signature</button><span aria-live="polite" className="text-sm text-on-surface-variant">{value ? "Signature captured" : "No signature yet"}</span></div>
  </div>;
}
