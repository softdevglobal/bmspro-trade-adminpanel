"use client";

import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import { motion } from "framer-motion";
import { Eye } from "lucide-react";

type Props = {
  tenant: TenantDetail;
  onClick: () => void;
};

export function TenantViewButton({ tenant, onClick }: Props) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={`View ${tenant.businessName}`}
      title="View details"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary-fixed/50"
    >
      <Eye className="h-[18px] w-[18px] stroke-[2px]" aria-hidden />
    </motion.button>
  );
}
