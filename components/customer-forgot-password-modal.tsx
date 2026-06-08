"use client";

import { ForgotPasswordModal } from "@/components/forgot-password-modal";

type Props = {
  open: boolean;
  onClose: () => void;
  initialEmail?: string;
  bookingSlug?: string;
};

/** Customer booking accounts — ZeptoMail 6-digit code via `/api/customer/auth/*`. */
export function CustomerForgotPasswordModal({
  open,
  onClose,
  initialEmail,
  bookingSlug,
}: Props) {
  return (
    <ForgotPasswordModal
      open={open}
      onClose={onClose}
      initialEmail={initialEmail}
      sendCodeUrl="/api/customer/auth/send-reset-code"
      resetPasswordUrl="/api/customer/auth/reset-password"
      sendExtraBody={bookingSlug ? { bookingSlug } : undefined}
      minPasswordLength={6}
      zIndexClass="z-[210]"
    />
  );
}
