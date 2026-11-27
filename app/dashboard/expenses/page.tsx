import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { ExpensesPageContent } from "@/components/expenses/expenses-page-content";
import { ModuleAccessGuard } from "@/components/module-access-guard";

export default function ExpensesPage() {
  return (
    <BusinessOwnerGuard>
      <ModuleAccessGuard module="expenses">
        <ExpensesPageContent />
      </ModuleAccessGuard>
    </BusinessOwnerGuard>
  );
}
