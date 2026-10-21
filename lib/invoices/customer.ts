import type {
  InspectionAddress,
  InspectionCustomer,
} from "@/lib/inspection/types";
import type { CreateInvoiceInput } from "@/lib/invoices/types";

/**
 * Who the invoice is addressed to. The quotation's customer by default; an
 * edit from the invoice screen (web or mobile) corrects it on the invoice
 * alone, so the quotation keeps what it was sent with. A blank name is
 * ignored rather than wiping the customer.
 */
export function resolveInvoiceCustomer(
  input: Pick<CreateInvoiceInput, "customer" | "address">,
  quotation: { customer: InspectionCustomer; address: InspectionAddress },
): { customer: InspectionCustomer; address: InspectionAddress } {
  const fullName = input.customer?.fullName?.trim() ?? "";
  const customer: InspectionCustomer =
    input.customer && fullName
      ? {
          fullName,
          email: input.customer.email?.trim() ?? "",
          phone: input.customer.phone?.trim() ?? "",
        }
      : quotation.customer;
  const address: InspectionAddress = input.address
    ? {
        street: input.address.street?.trim() ?? "",
        suburb: input.address.suburb?.trim() ?? "",
        state: input.address.state?.trim() ?? "",
        postcode: input.address.postcode?.trim() ?? "",
      }
    : quotation.address;
  return { customer, address };
}
