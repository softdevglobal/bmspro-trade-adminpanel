import { CustomerProviders } from "@/components/customer-providers";

/** Customer-facing booking pages need the customer session and notifications. */
export default function BookNowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CustomerProviders>{children}</CustomerProviders>;
}
