import {
  booknowAccountMetadata,
  renderBooknowAccountPage,
} from "@/lib/customer/render-booknow-account";
import type { CustomerAccountTab } from "@/components/customer-account-nav";

export const dynamic = "force-dynamic";

type PageParams = { slug: string };

export function createBooknowAccountTabPage(tab: CustomerAccountTab) {
  async function generateMetadata({
    params,
  }: {
    params: Promise<PageParams>;
  }) {
    const { slug } = await params;
    return booknowAccountMetadata(slug, tab);
  }

  async function Page({ params }: { params: Promise<PageParams> }) {
    const { slug } = await params;
    return renderBooknowAccountPage(slug, tab);
  }

  return { generateMetadata, default: Page };
}
