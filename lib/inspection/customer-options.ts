import type { InspectionAddress, InspectionRequestDetail } from "@/lib/inspection/types";

export type CustomerOption = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  address: InspectionAddress | null;
  lastActivity: number;
};

function customerKey(request: InspectionRequestDetail): string {
  const email = request.customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = request.customer.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${request.customer.fullName.trim().toLowerCase()}`;
}

export function buildCustomerOptions(
  requests: InspectionRequestDetail[],
): CustomerOption[] {
  const map = new Map<string, CustomerOption>();
  for (const request of requests) {
    const key = customerKey(request);
    const activity = request.updatedAt ?? request.createdAt ?? 0;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        id: key,
        fullName: request.customer.fullName?.trim() || "Unknown",
        email: request.customer.email?.trim() || "",
        phone: request.customer.phone?.trim() || "",
        address: request.address,
        lastActivity: activity,
      });
      continue;
    }
    if (activity > existing.lastActivity) {
      existing.lastActivity = activity;
      existing.address = request.address;
    }
    if (!existing.fullName && request.customer.fullName) {
      existing.fullName = request.customer.fullName.trim();
    }
    if (!existing.email && request.customer.email) {
      existing.email = request.customer.email.trim();
    }
    if (!existing.phone && request.customer.phone) {
      existing.phone = request.customer.phone.trim();
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

export function filterCustomerOptions(
  options: CustomerOption[],
  query: string,
  limit = 8,
): CustomerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  return options
    .filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q),
    )
    .slice(0, limit);
}
