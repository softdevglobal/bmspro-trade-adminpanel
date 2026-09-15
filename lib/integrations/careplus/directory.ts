import "server-only";

import {
  listBusinessCustomers,
  listBusinessStaffDirectory,
  upsertCareplusIntegration,
} from "@/lib/integrations/careplus/mapping";
import { listAllTenants } from "@/lib/onboarding/tenant-list-server";

const DIRECTORY_LIMIT = 200;

export type TradeDirectoryTenant = {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
  abn: string | null;
  state: string;
};

export type TradeDirectoryPerson = {
  id: string;
  name: string;
  email?: string;
  role?: string;
};

export async function listDirectoryTenants(): Promise<TradeDirectoryTenant[]> {
  const tenants = await listAllTenants(DIRECTORY_LIMIT);
  return tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.businessName || tenant.id,
    status: tenant.status || "",
    isActive: tenant.isActive,
    abn: tenant.abn,
    state: tenant.state || "",
  }));
}

export async function listDirectoryCustomers(
  businessId: string,
): Promise<TradeDirectoryPerson[]> {
  const rows = await listBusinessCustomers(businessId);
  return rows.slice(0, DIRECTORY_LIMIT).map((row) => ({
    id: row.uid,
    name: row.fullName || row.uid,
    email: row.email || undefined,
  }));
}

export async function listDirectoryStaff(
  businessId: string,
): Promise<TradeDirectoryPerson[]> {
  const rows = await listBusinessStaffDirectory(businessId);
  return rows.slice(0, DIRECTORY_LIMIT).map((row) => ({
    id: row.uid,
    name: row.fullName || row.uid,
    email: row.email || undefined,
    role: row.role,
  }));
}

export async function linkDirectoryProvider(input: {
  businessId: string;
  careplusProviderId: string;
}) {
  return upsertCareplusIntegration({
    businessId: input.businessId,
    careplusProviderId: input.careplusProviderId,
    actorUid: "careplus-directory",
    actorEmail: undefined,
  });
}
