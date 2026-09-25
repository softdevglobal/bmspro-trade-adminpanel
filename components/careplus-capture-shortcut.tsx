import Link from "next/link";

/** Compact entry point from jobs / customers / staff into CarePlus capture. */
export function CareplusCaptureShortcut({ context }: { context: string }) {
  return (
    <p className="rounded-xl border border-outline-variant/70 bg-surface-container-low px-3 py-2.5 font-body text-[12px] text-on-surface-variant">
      Capture an incident, complaint or risk for CarePlus from{" "}
      <Link
        href="/dashboard/careplus-records"
        className="font-semibold text-primary underline-offset-2 hover:underline"
      >
        CarePlus records
      </Link>
      {context ? ` · ${context}` : ""}. CarePlus takes the follow-up action.
    </p>
  );
}
