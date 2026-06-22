/** Firestore collection for SMS add-on packages. */
export const SMS_PACKAGES_COLLECTION = "sms_packages";

export type SmsPackage = {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  messageQuota: number;
  features: string[];
  popular: boolean;
  color: string;
  image: string;
  icon: string;
  active: boolean;
  hidden: boolean;
  stripePriceId: string | null;
  plan_key: string | null;
  description: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type SmsPackageInput = {
  name: string;
  price: number;
  priceLabel?: string;
  messageQuota: number;
  features?: string[];
  popular?: boolean;
  color?: string;
  image?: string;
  icon?: string;
  active?: boolean;
  hidden?: boolean;
  stripePriceId?: string | null;
  plan_key?: string | null;
  description?: string | null;
};
