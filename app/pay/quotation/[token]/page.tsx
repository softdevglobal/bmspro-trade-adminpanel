import { PublicPaymentCheckout } from "@/components/public-payment-checkout";
import { getPublicPaymentContext } from "@/lib/payments/public";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pay deposit",
};

export default async function QuotationPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  const context = await getPublicPaymentContext(token);
  if (!context || context.type !== "quotation") {
    notFound();
  }

  const rawStatus = typeof sp.status === "string" ? sp.status : null;
  const status =
    rawStatus === "success"
      ? "success"
      : rawStatus === "cancelled"
        ? "cancelled"
        : null;
  const sessionId =
    typeof sp.session_id === "string" ? sp.session_id : null;

  return (
    <PublicPaymentCheckout
      context={context}
      initialStatus={status}
      sessionId={sessionId}
    />
  );
}
