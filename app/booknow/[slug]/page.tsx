import { BookingEngine } from "@/components/booking-engine";
import { loadBookingServices, type BookingService } from "@/lib/booking/public";
import { adminDb } from "@/lib/firebase/admin";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export type { BookingService };

export type BookingBusiness = {
  id: string;
  slug: string;
  businessName: string;
  businessType: string;
  businessPhone: string | null;
  businessEmail: string | null;
  businessAddress: string | null;
  state: string | null;
  postcode: string | null;
  serviceAreas: string[];
  logoUrl: string | null;
  isActive: boolean;
};

async function loadBusinessBySlug(
  slug: string
): Promise<BookingBusiness | null> {
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", slug)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  return {
    id: doc.id,
    slug,
    businessName: typeof data.businessName === "string" ? data.businessName : "",
    businessType: typeof data.businessType === "string" ? data.businessType : "",
    businessPhone:
      typeof data.businessPhone === "string" ? data.businessPhone : null,
    businessEmail:
      typeof data.businessEmail === "string" ? data.businessEmail : null,
    businessAddress:
      typeof data.businessAddress === "string" && data.businessAddress.trim()
        ? data.businessAddress.trim()
        : null,
    state: typeof data.state === "string" ? data.state : null,
    postcode: typeof data.postcode === "string" ? data.postcode : null,
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
    serviceAreas: Array.isArray(data.serviceAreas)
      ? (data.serviceAreas as unknown[])
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v): v is string => v.length > 0)
      : [],
    isActive: Boolean(data.isActive),
  };
}

export async function generateMetadata({
  params,
}: PageProps<"/booknow/[slug]">) {
  const { slug } = await params;
  const business = await loadBusinessBySlug(slug);
  if (!business) {
    return { title: "Booking not found" };
  }
  return {
    title: `Book ${business.businessName} — BMS Pro Trade`,
    description: `Request a booking with ${business.businessName} (${business.businessType}).`,
  };
}

export default async function BookNowPage({
  params,
}: PageProps<"/booknow/[slug]">) {
  const { slug } = await params;
  const business = await loadBusinessBySlug(slug);
  if (!business) notFound();

  const services = await loadBookingServices(business.id);

  return <BookingEngine business={business} services={services} />;
}
