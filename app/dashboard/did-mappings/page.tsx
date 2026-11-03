import type { Metadata } from "next";
import { DidMappingsBoard } from "@/components/did-mappings-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";

export const metadata: Metadata = { title: "DID mappings - BMS Pro Trade" };
export default function DidMappingsPage() {
  return <SuperAdminGuard><DidMappingsBoard /></SuperAdminGuard>;
}
