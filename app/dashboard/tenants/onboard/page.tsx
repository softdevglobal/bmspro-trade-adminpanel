import { redirect } from "next/navigation";

export default function TenantOnboardRedirect() {
  redirect("/dashboard/tenants");
}
