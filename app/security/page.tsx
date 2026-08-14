import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security - BMS Pro Trade",
  description: "How to report a security vulnerability in BMS Pro Trade.",
};

const SECURITY_CONTACT =
  process.env.SECURITY_CONTACT_EMAIL ?? "security@bmspros.com.au";

/**
 * The disclosure policy referenced by /.well-known/security.txt. A security.txt
 * whose Policy line 404s is worse than no Policy line, so the two ship together.
 */
export default function SecurityPolicyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-on-background">
          Reporting a security issue
        </h1>
        <p className="text-on-surface-variant">
          We welcome reports from security researchers and customers. If you
          believe you have found a vulnerability in BMS Pro Trade, please tell us
          before disclosing it publicly.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-on-background">
          How to report
        </h2>
        <p className="text-on-surface-variant">
          Email{" "}
          <a
            className="font-medium text-primary underline underline-offset-2"
            href={`mailto:${SECURITY_CONTACT}`}
          >
            {SECURITY_CONTACT}
          </a>
          . Include the affected URL or endpoint, the steps to reproduce, and
          what you were able to access. Screenshots or a short recording help.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-on-background">
          What to expect
        </h2>
        <p className="text-on-surface-variant">
          We aim to acknowledge reports within five business days and will keep
          you updated while we investigate. We do not currently run a paid bounty
          programme.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-on-background">
          Testing guidelines
        </h2>
        <p className="text-on-surface-variant">
          Please test only against accounts and data you own. Do not run
          denial-of-service or load tests, do not access, modify, or retain other
          customers&rsquo; data, and stop as soon as you have enough to
          demonstrate the issue. We will not pursue action against researchers
          who follow these guidelines and report in good faith.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-on-background">
          Machine-readable contact
        </h2>
        <p className="text-on-surface-variant">
          The same details are published at{" "}
          <a
            className="font-medium text-primary underline underline-offset-2"
            href="/.well-known/security.txt"
          >
            /.well-known/security.txt
          </a>
          .
        </p>
      </section>
    </main>
  );
}
