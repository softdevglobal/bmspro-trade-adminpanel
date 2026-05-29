import { createBooknowAccountTabPage } from "@/lib/customer/booknow-account-tab-page";

const { generateMetadata, default: Page } =
  createBooknowAccountTabPage("bookings");

export { generateMetadata };
export default Page;
