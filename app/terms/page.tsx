import { Callout, LegalDocument, LegalList, LegalSection } from "@/components/legal-shell";
import { LEGAL_LAST_UPDATED, PRIVACY_CONTACT, PRODUCT_NAME } from "@/lib/legal/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Terms of Service - ${PRODUCT_NAME}`,
  description: `The terms for using ${PRODUCT_NAME}.`,
  robots: { index: true, follow: true },
};

const link = "font-medium text-primary underline underline-offset-2";

const GLANCE = [
  { icon: "folder_shared", title: "Your data is yours", text: "You own what you put in. We only process it to run the service for you." },
  { icon: "mail_lock", title: "You control Gmail", text: "Connecting is optional, owner-only, and you can disconnect at any time." },
  { icon: "handshake", title: "Use it fairly", text: "No spam, no prying into other businesses' data, no abuse of the service." },
  { icon: "support_agent", title: "We keep it running", text: "We work to keep it secure and available, and tell you about big changes." },
];

const TOC = [
  { id: "service", title: "The service", icon: "construction" },
  { id: "accounts", title: "Accounts", icon: "manage_accounts" },
  { id: "content", title: "Your content", icon: "folder_shared" },
  { id: "gmail", title: "Connecting Gmail", icon: "mail" },
  { id: "use", title: "Acceptable use", icon: "gavel" },
  { id: "fees", title: "Fees and payments", icon: "payments" },
  { id: "availability", title: "Availability", icon: "cloud_done" },
  { id: "ending", title: "Suspension and ending", icon: "logout" },
  { id: "liability", title: "Liability", icon: "balance" },
  { id: "changes", title: "Changes", icon: "edit_note" },
  { id: "contact", title: "Contact", icon: "contact_support" },
];

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      icon="description"
      eyebrow="Terms of Service"
      title="The simple rules for using the platform"
      intro={`These terms govern your use of ${PRODUCT_NAME}. By creating an account or using the platform you agree to them. If you use it for a business, you confirm you can accept these terms on the business's behalf.`}
      updated={LEGAL_LAST_UPDATED}
      glance={GLANCE}
      toc={TOC}
    >
      <LegalSection id="service" icon="construction" title="The service">
        <p>
          {PRODUCT_NAME}{" "}helps trade businesses manage site inspections,
          bookings, quotations, jobs, invoices, team members, customers and
          customer communication, including sending email from the
          business&rsquo;s own Gmail account and using that mailbox inside the
          platform.
        </p>
      </LegalSection>

      <LegalSection id="accounts" icon="manage_accounts" title="Accounts">
        <LegalList
          items={[
            "Keep your sign-in details secure; you are responsible for activity on your account and for the staff you add.",
            "Give accurate information and keep it up to date.",
            "Business owners decide who in their business has access.",
          ]}
        />
      </LegalSection>

      <LegalSection id="content" icon="folder_shared" title="Your content and your customers">
        <p>
          You own the information you put into the platform. You are responsible
          for having the right to use it, for the accuracy of the quotations,
          invoices and messages you send, and for complying with the laws that
          apply to your business, including privacy, spam and consumer laws. You
          give us permission to process that information to provide the service.
        </p>
      </LegalSection>

      <LegalSection id="gmail" icon="mail" title="Connecting your Gmail account">
        <LegalList
          items={[
            "Connecting Gmail is optional and only a business owner can do it, with an account the owner is entitled to use.",
            "Email sent through the platform is sent from your Gmail address and counts toward Google's sending limits; you are responsible for its content.",
            "You can disconnect at any time from the Emails page, or remove access in your Google Account.",
          ]}
        />
        <Callout icon="policy" title="How we handle your Google data">
          <p>
            It is set out in our{" "}
            <a className={link} href="/privacy">Privacy Policy</a>, including our
            compliance with the Google API Services User Data Policy and its
            Limited Use requirements.
          </p>
        </Callout>
      </LegalSection>

      <LegalSection id="use" icon="gavel" title="Acceptable use">
        <p>You must not:</p>
        <LegalList
          items={[
            "use the platform unlawfully, to send spam or deceptive messages, or to infringe anyone's rights;",
            "try to access other businesses' data, probe or disrupt the service, or bypass its security;",
            "upload malicious code or content you have no right to share;",
            "resell or provide the service to others except as we allow.",
          ]}
        />
      </LegalSection>

      <LegalSection id="fees" icon="payments" title="Fees and payments">
        <p>
          Paid plans, SMS credits and payment processing are charged as shown
          when you subscribe or buy. Card payments from your customers are
          processed by Stripe under its own terms.
        </p>
      </LegalSection>

      <LegalSection id="availability" icon="cloud_done" title="Availability and changes">
        <p>
          We work to keep the platform available and secure but do not promise it
          will be uninterrupted or error-free. Features that depend on third
          parties, such as Google, Stripe and SMS carriers, can change or be
          unavailable. We may improve, change or remove features, and we will
          give notice of material changes.
        </p>
      </LegalSection>

      <LegalSection id="ending" icon="logout" title="Suspension and ending">
        <p>
          You can stop using the platform at any time. We may suspend or end
          access if these terms are breached, to protect the service or other
          users, or if fees are unpaid. On ending, you can ask for your data to
          be exported or deleted, subject to records we must keep by law.
        </p>
      </LegalSection>

      <LegalSection id="liability" icon="balance" title="Liability">
        <p>
          To the extent the law allows, the platform is provided as is, and we
          are not liable for indirect or consequential loss, lost profits or lost
          data, and our total liability for any claim is limited to the fees you
          paid us in the 12 months before it. Nothing in these terms limits any
          rights you have under consumer law that cannot be excluded.
        </p>
      </LegalSection>

      <LegalSection id="changes" icon="edit_note" title="Changes to these terms">
        <p>
          We may update these terms. If you keep using the platform after the
          date at the top changes, you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" icon="contact_support" title="Contact">
        <p>
          Questions about these terms:{" "}
          <a className={link} href={`mailto:${PRIVACY_CONTACT}`}>
            {PRIVACY_CONTACT}
          </a>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
