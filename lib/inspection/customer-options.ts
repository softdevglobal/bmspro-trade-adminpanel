import type { BookingDetail } from "@/lib/bookings/types";
import type {
  InspectionAddress,
  InspectionCustomer,
  InspectionRequestDetail,
} from "@/lib/inspection/types";
import { formatAddress } from "@/lib/inspection/types";

export type CustomerOption = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  address: InspectionAddress | null;
  lastActivity: number;
};

type CustomerOptionRecord = CustomerOption & {
  addressActivity: number;
};

function customerKeyFromContact(customer: InspectionCustomer): string {
  const email = customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = customer.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${customer.fullName.trim().toLowerCase()}`;
}

function customerKey(request: InspectionRequestDetail): string {
  return customerKeyFromContact(request.customer);
}

export function hasUsableCustomerAddress(
  address: InspectionAddress | null | undefined,
): boolean {
  if (!address) return false;
  return Boolean(
    address.street?.trim() ||
      address.suburb?.trim() ||
      address.state?.trim() ||
      address.postcode?.trim(),
  );
}

function normalizeCustomerAddress(
  address: InspectionAddress | null | undefined,
): InspectionAddress | null {
  if (!hasUsableCustomerAddress(address) || !address) return null;
  return {
    street: address.street?.trim() ?? "",
    suburb: address.suburb?.trim() ?? "",
    state: address.state?.trim() ?? "",
    postcode: address.postcode?.trim() ?? "",
  };
}

function mergeCustomerRecord(
  existing: CustomerOptionRecord,
  input: {
    fullName: string;
    email: string;
    phone: string;
    address: InspectionAddress | null;
    activity: number;
  },
): void {
  if (input.activity > existing.lastActivity) {
    existing.lastActivity = input.activity;
  }

  const nextAddress = normalizeCustomerAddress(input.address);
  if (
    nextAddress &&
    (!hasUsableCustomerAddress(existing.address) ||
      input.activity >= existing.addressActivity)
  ) {
    existing.address = nextAddress;
    existing.addressActivity = input.activity;
  }

  if (!existing.fullName && input.fullName) {
    existing.fullName = input.fullName;
  }
  if (!existing.email && input.email) {
    existing.email = input.email;
  }
  if (!existing.phone && input.phone) {
    existing.phone = input.phone;
  }
}

function upsertCustomerRecord(
  map: Map<string, CustomerOptionRecord>,
  key: string,
  input: {
    fullName: string;
    email: string;
    phone: string;
    address: InspectionAddress | null;
    activity: number;
  },
): void {
  const existing = map.get(key);
  if (!existing) {
    const address = normalizeCustomerAddress(input.address);
    map.set(key, {
      id: key,
      fullName: input.fullName || "Unknown",
      email: input.email,
      phone: input.phone,
      address,
      lastActivity: input.activity,
      addressActivity: address ? input.activity : 0,
    });
    return;
  }

  mergeCustomerRecord(existing, input);
}

export function buildCustomerOptions(
  requests: InspectionRequestDetail[],
  jobs: BookingDetail[] = [],
): CustomerOption[] {
  const map = new Map<string, CustomerOptionRecord>();

  for (const request of requests) {
    const key = customerKey(request);
    const activity = request.updatedAt ?? request.createdAt ?? 0;
    upsertCustomerRecord(map, key, {
      fullName: request.customer.fullName?.trim() || "Unknown",
      email: request.customer.email?.trim() || "",
      phone: request.customer.phone?.trim() || "",
      address: request.address,
      activity,
    });
  }

  for (const job of jobs) {
    const key = customerKeyFromContact(job.customer);
    const activity = job.updatedAt ?? job.createdAt ?? 0;
    upsertCustomerRecord(map, key, {
      fullName: job.customer.fullName?.trim() || "Unknown",
      email: job.customer.email?.trim() || "",
      phone: job.customer.phone?.trim() || "",
      address: job.address,
      activity,
    });
  }

  return Array.from(map.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

export function formatCustomerAddressLine(
  address: InspectionAddress | null | undefined,
): string | null {
  if (!hasUsableCustomerAddress(address) || !address) return null;
  const formatted = formatAddress(address).trim();
  return formatted || null;
}

export function filterCustomerOptions(
  options: CustomerOption[],
  query: string,
  limit = 8,
): CustomerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  return options
    .filter((customer) => {
      const addressLine = formatCustomerAddressLine(customer.address);
      return (
        customer.fullName.toLowerCase().includes(q) ||
        customer.email.toLowerCase().includes(q) ||
        customer.phone.includes(q) ||
        (addressLine?.toLowerCase().includes(q) ?? false)
      );
    })
    .slice(0, limit);
}
