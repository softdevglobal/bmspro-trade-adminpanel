/**
 * Transactional email templates — one file per email type.
 * Shared HTML shell: `lib/email/layout.ts`
 */
export {
  renderEmail,
  renderCustomerEmail,
  type EmailDetailRow,
  type EmailTemplateContent,
  type EmailTone,
} from "@/lib/email/layout";

export {
  sendOwnerWelcomeEmail,
  type OwnerWelcomeEmailInput,
} from "@/lib/email/templates/owner-welcome";

export {
  sendCustomerWelcomeEmail,
  type CustomerWelcomeEmailInput,
} from "@/lib/email/templates/customer-welcome";

export {
  sendStaffWelcomeEmail,
  type StaffWelcomeEmailInput,
} from "@/lib/email/templates/staff-welcome";

export {
  sendPasswordResetCodeEmail,
  type PasswordResetCodeEmailInput,
} from "@/lib/email/templates/password-reset-code";

export {
  sendCustomerPasswordResetCodeEmail,
  type CustomerPasswordResetCodeEmailInput,
} from "@/lib/email/templates/customer-password-reset-code";

export {
  sendInspectionCustomerNotificationEmail,
  type InspectionCustomerNotificationEmailInput,
} from "@/lib/email/templates/inspection-customer-notification";

export {
  sendQuotationSentEmail,
  type QuotationSentEmailInput,
} from "@/lib/email/templates/quotation-sent";
