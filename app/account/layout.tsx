import { CustomerProviders } from "@/components/customer-providers";

/** The customer account area runs on the customer session, not the admin one. */
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CustomerProviders>{children}</CustomerProviders>;
}
