import { createBooknowAccountTabPage } from "@/lib/customer/booknow-account-tab-page";

const { generateMetadata, default: Page } = createBooknowAccountTabPage("activity");

export { generateMetadata };
export default Page;
