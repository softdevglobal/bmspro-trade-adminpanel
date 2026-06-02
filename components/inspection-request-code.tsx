import {
  inspectionRequestCodeParts,
  type InspectionRequestCodeParts,
} from "@/lib/reference-codes";

type InspectionRequestCodeProps = {
  request: { id: string; requestCode?: string | null };
  className?: string;
};

export function InspectionRequestCode({
  request,
  className = "inline-flex items-baseline gap-px font-mono text-[12px] font-semibold text-primary",
}: InspectionRequestCodeProps) {
  const parts = inspectionRequestCodeParts(request);
  return (
    <InspectionRequestCodePartsView parts={parts} className={className} />
  );
}

export function InspectionRequestCodePartsView({
  parts,
  className = "inline-flex items-baseline gap-px",
}: {
  parts: InspectionRequestCodeParts;
  className?: string;
}) {
  if (!parts.segment) {
    return <span className={className}>{parts.prefix}</span>;
  }
  return (
    <span className={className}>
      <span>{parts.prefix}</span>
      <span>{parts.segment}</span>
    </span>
  );
}
