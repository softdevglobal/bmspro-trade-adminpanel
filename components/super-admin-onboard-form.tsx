"use client";

import { BusinessOnboardingForm } from "@/components/business-onboarding-form";
import { auth } from "@/lib/firebase/client";

type Props = {
  compact?: boolean;
  onSuccess?: (tenantId: string) => void;
};

export function SuperAdminOnboardForm({ compact, onSuccess }: Props) {
  return (
    <BusinessOnboardingForm
      mode="super_admin_create"
      endpoint="/api/admin/tenants/create"
      submitLabel="Create Tenant"
      compact={compact}
      getRequestHeaders={async () => {
        const user = auth.currentUser;
        if (!user) return null;
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
      }}
      onSuccess={onSuccess}
    />
  );
}
