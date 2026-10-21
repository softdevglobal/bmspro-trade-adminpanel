import { Callout, LegalDocument, LegalList, LegalSection } from "@/components/legal-shell";
import { LEGAL_LAST_UPDATED, PRIVACY_CONTACT, PRODUCT_NAME } from "@/lib/legal/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Privacy Policy - ${PRODUCT_NAME}`,
  description: `How ${PRODUCT_NAME} collects, uses, stores and protects information, including Google user data.`,
  robots: { index: true, follow: true },
};

const link = "font-medium text-primary underline underline-offset-2";

const GLANCE = [
  { icon: "money_off", title: "Never sold", text: "We don't sell your data, and we never use Gmail data for advertising." },
  { icon: "psychology_alt", title: "No AI training", text: "Your email is never used to train AI or machine learning models." },
  { icon: "visibility", title: "Read when you open it", text: "Received email bodies and attachments are fetched from Gmail on demand, not stored." },
  { icon: "link_off", title: "Disconnect anytime", text: "One click stops access, revokes it at Google and deletes the imported mail details." },
];

const TOC = [
  { id: "collect", title: "What we collect", icon: "inventory_2" },
  { id: "gmail", title: "Your Gmail account", icon: "mail" },
  { id: "use", title: "How we use it", icon: "tune" },
  { id: "share", title: "Who we share with", icon: "diversity_3" },
  { id: "security", title: "How we protect it", icon: "shield_lock" },
  { id: "retention", title: "Keeping and deleting", icon: "auto_delete" },
  { id: "rights", title: "Your rights", icon: "verified_user" },
  { id: "changes", title: "Changes", icon: "edit_note" },
  { id: "contact", title: "Contact us", icon: "contact_support" },
];

const PERMISSIONS = [
  {
    icon: "badge",
    name: "Identity",
    scope: "openid · email",
    text: "Shows which Gmail address is connected and makes sure the same account is reused.",
    tone: "bg-sky-50 text-sky-700",
  },
  {
    icon: "send",
    name: "Send email",
    scope: "gmail.send",
    text: "Sends quotations, invoices and emails you write, from your own Gmail address.",
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    icon: "inbox",
    name: "Read and manage mail",
    scope: "gmail.modify · only if you turn on the Mailbox",
    text: "Shows your Inbox, Starred, Sent, Archive and Trash here; lets you open, reply, forward, star, archive and delete; and links conversations to your customers, quotes and invoices. It cannot permanently delete mail.",
    tone: "bg-violet-50 text-violet-700",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      icon="lock"
      eyebrow="Privacy Policy"
      title="Your business and your email stay yours"
      intro={`${PRODUCT_NAME} helps trade businesses manage site inspections, quotations, jobs, invoices, customers and email. This policy explains what we handle, why, and the choices you have.`}
      updated={LEGAL_LAST_UPDATED}
      glance={GLANCE}
      toc={TOC}
    >
      <LegalSection id="collect" icon="inventory_2" title="What we collect">
        <p>
          This applies to business owners and staff who use the platform, and to
          customers whose details a business adds to it.
        </p>
        <LegalList
          items={[
            "Account details: name, email address and phone number of owners, staff and customers, and a business's name, address, ABN and branding.",
            "Business records a business creates: customers, site inspections, quotations, invoices, jobs, team and attendance records, and messages sent through the platform.",
            "Payment details are handled by our payment provider, Stripe. We do not store card numbers.",
            "Google user data, only if a business owner chooses to connect a Gmail account. This is described in the next section.",
            "Technical information such as device, browser and log data, used to keep the service secure and working.",
          ]}
        />
      </LegalSection>

      <LegalSection id="gmail" icon="mail" title="Your Gmail account">
        <p>
          A business owner can connect their own Gmail account. Each feature asks
          for the smallest permission it needs, and the owner approves every one
          on Google&rsquo;s consent screen.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {PERMISSIONS.map((permission) => (
            <article key={permission.name} className="flex flex-col rounded-xl border border-outline-variant/70 bg-surface-container-low p-4">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${permission.tone}`}>
                <span aria-hidden className="material-symbols-outlined text-[22px]">{permission.icon}</span>
              </span>
              <h3 className="mt-3 font-display text-[15px] font-semibold text-on-background">{permission.name}</h3>
              <p className="mt-0.5 font-mono text-[11px] text-on-surface-variant">{permission.scope}</p>
              <p className="mt-2 text-[13px] leading-relaxed">{permission.text}</p>
            </article>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="flex items-center gap-2 font-display text-[15px] font-semibold text-emerald-900">
              <span aria-hidden className="material-symbols-outlined text-[20px]">save</span>
              What we store
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-emerald-950/80">
              <li>The connected address and name.</li>
              <li>Encrypted access credentials.</li>
              <li>A record of each email sent from the platform: recipients, subject, body and any attached document.</li>
              <li>With the Mailbox on: for each message, its Gmail identifiers, sender, recipients, subject, a short preview, date, labels, and whether it has attachments.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
            <p className="flex items-center gap-2 font-display text-[15px] font-semibold text-rose-900">
              <span aria-hidden className="material-symbols-outlined text-[20px]">delete_forever</span>
              What we don&rsquo;t store
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-rose-950/80">
              <li>The full body of received email. It is read from Gmail when you open a message.</li>
              <li>Attachments of received email. They are downloaded from Gmail only when you open them.</li>
              <li>Your Gmail password. We never see it; Google signs you in.</li>
              <li>Spam and draft messages.</li>
            </ul>
          </div>
        </div>

        <Callout icon="policy" title="Google API Services User Data Policy — Limited Use">
          <p>
            {PRODUCT_NAME}&rsquo;s use and transfer to any other app of
            information received from Google APIs will adhere to the{" "}
            <a
              className={link}
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. In particular, we:
          </p>
          <LegalList
            items={[
              "use Google user data only to provide and improve the user-facing email features described above;",
              "do not sell Google user data or transfer it to data brokers or advertising platforms, and do not use it for advertising, including personalised or retargeted ads;",
              "do not use Google user data to develop, improve or train generalised artificial intelligence or machine learning models;",
              "do not allow people to read a user's Gmail data unless the user has asked us to for a specific message, it is needed for security or to comply with the law, or the data is aggregated and anonymised for internal operations;",
              "do not transfer Google user data to others except to provide the features above, to comply with the law, or as part of a merger or sale with notice to users.",
            ]}
          />
        </Callout>
      </LegalSection>

      <LegalSection id="use" icon="tune" title="How we use information">
        <LegalList
          items={[
            "To provide the platform: bookings, quotations, invoices, jobs, notifications and email.",
            "To keep accounts secure, prevent misuse and troubleshoot problems.",
            "To send service messages such as account, booking and invoice emails and SMS.",
            "To meet legal and accounting obligations.",
          ]}
        />
        <p className="font-semibold text-on-surface">We do not sell personal information.</p>
      </LegalSection>

      <LegalSection id="share" icon="diversity_3" title="Who we share information with">
        <p>
          Only with service providers that run the platform for us and are bound
          to protect it: cloud hosting and database services (Google Cloud /
          Firebase and Vercel), payments (Stripe), and email and SMS delivery. We
          also disclose information when the law requires it. A business&rsquo;s
          data is visible to that business and the people it authorises, never to
          other businesses.
        </p>
      </LegalSection>

      <LegalSection id="security" icon="shield_lock" title="How we protect it">
        <LegalList
          items={[
            "Data is encrypted in transit (HTTPS).",
            "Gmail credentials are encrypted at rest with AES-256-GCM, with the key held separately from the database, and are never sent to the browser.",
            "Mail data and credentials sit in collections that no browser or app can read directly. They are reachable only through our server, which checks the signed-in owner and business on every request.",
            "Only business owners can connect a mailbox or use it in the platform.",
            "Email is displayed in a locked-down frame that cannot run scripts, and images from the web are blocked until the owner allows them.",
          ]}
        />
        <p>
          To report a vulnerability, see our{" "}
          <a className={link} href="/security">security page</a>.
        </p>
      </LegalSection>

      <LegalSection id="retention" icon="auto_delete" title="Keeping and deleting">
        <p>
          Business records are kept while the account is active and for as long
          as the business needs them for its legal and accounting obligations.
        </p>
        <Callout icon="link_off" title="Disconnecting Gmail">
          <p>
            Choosing <strong>Emails → Disconnect</strong> stops all access
            straight away, revokes our access at Google, deletes the stored
            credentials and deletes the message details imported from the
            mailbox. The record of emails already sent from the platform stays
            with the business&rsquo;s records; ask us if you want it deleted.
          </p>
          <p>
            You can also remove{" "}{PRODUCT_NAME}{" "}at any time at{" "}
            <a
              className={link}
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            , after which our access stops working.
          </p>
        </Callout>
      </LegalSection>

      <LegalSection id="rights" icon="verified_user" title="Your rights">
        <p>
          You can ask to access, correct or delete the personal information we
          hold about you, or ask a question or make a complaint about how we
          handle it, by contacting us below. If you are in Australia, we handle
          personal information in line with the Australian Privacy Principles.
          Customers of a business can also contact that business directly.
        </p>
      </LegalSection>

      <LegalSection id="changes" icon="edit_note" title="Changes to this policy">
        <p>
          We may update this policy as the platform changes. The date at the top
          shows the latest version, and we will tell account holders about
          significant changes.
        </p>
      </LegalSection>

      <LegalSection id="contact" icon="contact_support" title="Contact us">
        <p>
          Questions or requests about privacy:{" "}
          <a className={link} href={`mailto:${PRIVACY_CONTACT}`}>
            {PRIVACY_CONTACT}
          </a>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
