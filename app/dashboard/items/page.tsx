import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { ItemListBoard } from "@/components/item-list-board";

export default function ItemsPage() {
  return (
    <BusinessOwnerGuard>
      <ItemListBoard />
    </BusinessOwnerGuard>
  );
}
