import { createBooknowAccountTabPage } from "@/lib/customer/booknow-account-tab-page";

const { generateMetadata, default: Page } =
  createBooknowAccountTabPage("jobs");

export { generateMetadata };
export default Page;
