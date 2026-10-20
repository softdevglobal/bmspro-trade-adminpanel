import { PublicShell } from "@/components/legal-shell";
import { LoginRedirect } from "@/components/login-redirect";
import { PRODUCT_NAME } from "@/lib/legal/site";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - Run your trade business in one place`,
  description:
    "Site inspections, quotations, jobs, invoices, customers and email for trade businesses, in one platform.",
  robots: { index: true, follow: true },
};

const FEATURES = [
  { icon: "event_available", title: "Site inspections and jobs", text: "Take booking requests, schedule your team and track every job from first visit to completion." },
  { icon: "request_quote", title: "Quotations and invoices", text: "Build professional quotes, turn them into invoices and get paid by card or bank transfer." },
  { icon: "group", title: "Customers and team", text: "Keep customer history together, manage staff, attendance and leave." },
  { icon: "mail", title: "Email from your own address", text: "Send quotes and invoices from your business Gmail and keep customer conversations next to their quotes, invoices and jobs." },
];

/** Public home page: describes the product and links to the legal pages. */
export default function Home() {
  return (
    <PublicShell>
      {/* Signed-in owners go straight to their dashboard; everyone else sees this page. */}
      <LoginRedirect />
      <main>
        <section className="mx-auto w-full max-w-5xl px-6 pb-12 pt-16 text-center">
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            Run your trade business in one place
          </h1>
          <p className="mx-auto mt-4 max-w-2xl font-body text-[17px] leading-relaxed text-on-surface-variant">
            {PRODUCT_NAME}{" "}brings site inspections, quotations, jobs, invoices,
            customers and email together, so you spend less time on paperwork and
            more on the work.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-primary px-6 py-3 font-body text-[15px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-14 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-5">
              <span className="material-symbols-outlined text-[26px] text-primary">{feature.icon}</span>
              <h2 className="mt-2 font-display text-lg font-semibold">{feature.title}</h2>
              <p className="mt-1 font-body text-[14px] leading-relaxed text-on-surface-variant">{feature.text}</p>
            </article>
          ))}
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-16">
          <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low p-6">
            <h2 className="font-display text-lg font-semibold">How we use your Google account</h2>
            <p className="mt-2 font-body text-[14px] leading-relaxed text-on-surface-variant">
              If a business owner chooses to connect Gmail, {PRODUCT_NAME}{" "}uses
              that access only to send email from the owner&rsquo;s address and to
              show and manage the owner&rsquo;s own mailbox inside the platform.
              We never sell this data, use it for advertising or use it to train
              AI models. Owners can disconnect at any time. Read the full details
              in our{" "}
              <Link href="/privacy" className="font-medium text-primary underline underline-offset-2">
                Privacy Policy
              </Link>
              , which describes our use of Google user data, including our
              compliance with the Google API Services User Data Policy and its
              Limited Use requirements.
            </p>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
