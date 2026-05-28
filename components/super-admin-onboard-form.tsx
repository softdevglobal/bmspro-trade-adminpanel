"use client";

import {
  BusinessOnboardingForm,
  type BusinessOnboardingFormHandle,
  type OnboardingWizardStep,
} from "@/components/business-onboarding-form";
import { auth } from "@/lib/firebase/client";
import { forwardRef } from "react";

type Props = {
  compact?: boolean;
  externalFooter?: boolean;
  onSuccess?: (tenantId: string) => void;
  onStepChange?: (step: OnboardingWizardStep) => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
};

export const SuperAdminOnboardForm = forwardRef<
  BusinessOnboardingFormHandle,
  Props
>(function SuperAdminOnboardForm(
  {
    compact,
    externalFooter,
    onSuccess,
    onStepChange,
    onSubmittingChange,
  },
  ref,
) {
  return (
    <BusinessOnboardingForm
      ref={ref}
      mode="super_admin_create"
      endpoint="/api/admin/tenants/create"
      submitLabel="Create Tenant"
      compact={compact}
      externalFooter={externalFooter}
      onStepChange={onStepChange}
      onSubmittingChange={onSubmittingChange}
      getRequestHeaders={async () => {
        const user = auth.currentUser;
        if (!user) return null;
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
      }}
      onSuccess={onSuccess}
    />
  );
});
