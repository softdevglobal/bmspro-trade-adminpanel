import { createBooknowAccountTabPage } from "@/lib/customer/booknow-account-tab-page";

const { generateMetadata, default: Page } =
  createBooknowAccountTabPage("notifications");

export { generateMetadata };
export default Page;
