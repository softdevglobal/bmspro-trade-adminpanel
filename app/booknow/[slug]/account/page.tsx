import { renderBooknowAccountPage, booknowAccountMetadata } from "@/lib/customer/render-booknow-account";

export const dynamic = "force-dynamic";

type PageParams = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { slug } = await params;
  return booknowAccountMetadata(slug, "profile");
}

export default async function BooknowAccountProfilePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { slug } = await params;
  return renderBooknowAccountPage(slug, "profile");
}
