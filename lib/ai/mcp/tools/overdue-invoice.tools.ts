import "server-only";

import { renderEmail } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { claimOverdueInvoiceReminder, listOverdueInvoicePage } from "@/lib/invoices/server";
import { getBusinessProfile, type BusinessMemberAuth } from "@/lib/onboarding/server";
import { platformTodayIso } from "@/lib/platform/timezone";

export async function listOverdueInvoices(auth: BusinessMemberAuth, cursor?: string) {
  const profile = await getBusinessProfile(auth.businessId);
  return listOverdueInvoicePage(auth.businessId, profile?.timezone, cursor);
}

export async function notifyOverdueInvoice({ businessId }: Pick<BusinessMemberAuth, "businessId">, invoiceId: string) {
  const [profile, business] = await Promise.all([
    getBusinessProfile(businessId),
    adminDb.collection("businesses").doc(businessId).get(),
  ]);
  const ownerUid: unknown = business.get("ownerUid");
  let ownerEmail: string | undefined;
  if (typeof ownerUid === "string" && ownerUid) {
    try {
      ownerEmail = (await adminAuth.getUser(ownerUid)).email?.trim();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "auth/user-not-found")) throw error;
    }
  }
  const now = new Date();
  const claim = await claimOverdueInvoiceReminder({
    businessId, invoiceId, ownerEmail, now,
    timeZone: profile?.timezone, date: platformTodayIso(now, profile?.timezone),
  });
  if (!claim) return { status: "NOT_OVERDUE_OR_NOT_FOUND" };

  const { invoice, outstandingAud, recipients } = claim;
  const invoiceCode = invoice.invoiceCode || invoice.id;
  const amount = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(outstandingAud);
  const sendReminder = async (to: string | null, recipient: "customer" | "owner", skipped: string) => {
    if (!to) return skipped;
    try {
      const sent = await sendEmail({
        sender: "request", to, subject: `Overdue invoice ${invoiceCode}`,
        htmlBody: renderEmail({
          title: recipient === "customer" ? "Your invoice is overdue" : "An invoice is overdue",
          tone: "warning",
          body: recipient === "customer"
            ? "This is a reminder that payment is overdue. Please refer to the invoice we sent you for payment details."
            : `The invoice for ${invoice.customer.fullName || "your customer"} has an outstanding balance.`,
          details: [{ label: "Invoice", value: invoiceCode }, { label: "Due date", value: invoice.dueDate }],
          highlight: amount,
          highlightLabel: "Outstanding balance",
          businessName: profile?.businessName,
        }),
      });
      return sent ? "SENT" : "UNCONFIRMED";
    } catch {
      return "UNCONFIRMED";
    }
  };
  const [customer, owner] = await Promise.all([
    sendReminder(recipients.customer, "customer", claim.customerStatus),
    sendReminder(recipients.owner, "owner", claim.ownerStatus),
  ]);
  return { invoiceId, customer, owner };
}
