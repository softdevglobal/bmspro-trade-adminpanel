import { redirect } from "next/navigation";

export default function ParticipantOnboardingPage() {
  redirect("/dashboard/careplus-records?tab=onboarding");
}
