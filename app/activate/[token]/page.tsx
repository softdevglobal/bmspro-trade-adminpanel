import { ActivationForm } from "@/components/activation-form";

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="mx-auto my-16 w-full max-w-md px-6"><ActivationForm token={token} /></main>;
}
