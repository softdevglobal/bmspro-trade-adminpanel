import type { SmsPackageInput } from "@/lib/sms-packages/types";

export const DEFAULT_SMS_PACKAGE_SEEDS: {
  id: string;
  input: SmsPackageInput;
}[] = [
  {
    id: "sms_basic",
    input: {
      name: "SMS Basic",
      price: 29,
      messageQuota: 100,
      plan_key: "SMS_BASIC",
      popular: false,
      color: "teal",
      icon: "sms",
      description:
        "Transactional SMS for job updates, quotes, and invoice notifications.",
      features: [
        "100 SMS messages",
        "Job & invoice notifications",
        "Customer welcome messages",
      ],
    },
  },
  {
    id: "sms_standard",
    input: {
      name: "SMS Standard",
      price: 59,
      messageQuota: 500,
      plan_key: "SMS_STANDARD",
      popular: true,
      color: "cyan",
      icon: "forum",
      description:
        "Higher volume SMS for busy workshops sending regular customer updates.",
      features: [
        "500 SMS messages",
        "All transactional notifications",
        "Quotation & inspection alerts",
      ],
    },
  },
  {
    id: "sms_pro",
    input: {
      name: "SMS Pro",
      price: 99,
      messageQuota: 1500,
      plan_key: "SMS_PRO",
      popular: false,
      color: "purple",
      icon: "chat",
      description:
        "High-volume SMS for teams that rely on text messaging for daily operations.",
      features: [
        "1,500 SMS messages",
        "Priority delivery",
        "All notification types",
      ],
    },
  },
];
