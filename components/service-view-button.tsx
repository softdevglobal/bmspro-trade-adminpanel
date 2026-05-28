"use client";

import { motion } from "framer-motion";
import { Eye } from "lucide-react";

type Props = {
  label: string;
  onClick: () => void;
};

export function ServiceViewButton({ label, onClick }: Props) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={`View ${label}`}
      title="View details"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary-fixed/50"
    >
      <Eye className="h-[18px] w-[18px] stroke-[2px]" aria-hidden />
    </motion.button>
  );
}
