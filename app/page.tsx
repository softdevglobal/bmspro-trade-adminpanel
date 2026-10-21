import { PublicShell } from "@/components/legal-shell";
import { LoginRedirect } from "@/components/login-redirect";
import { PRODUCT_NAME } from "@/lib/legal/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - Run your trade business in one place`,
  description:
    "Site inspections, quotations, jobs, invoices, customers and email for trade businesses, in one platform.",
  robots: { index: true, follow: true },
};

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={`material-symbols-outlined ${className}`}>
      {name}
    </span>
  );
}

const TRUST = [
  { icon: "credit_card", text: "Card and bank transfer payments" },
  { icon: "mail_lock", text: "Email from your own Gmail" },
  { icon: "admin_panel_settings", text: "Owner and staff access levels" },
  { icon: "shield_lock", text: "Your data is never sold" },
];

const STEPS = [
  { icon: "event_available", title: "Request", text: "A customer books a site inspection online." },
  { icon: "request_quote", title: "Quote", text: "Send a professional quote they can accept." },
  { icon: "assignment_turned_in", title: "Job", text: "Schedule the work and keep your team on track." },
  { icon: "paid", title: "Invoice and paid", text: "Invoice in one tap and get paid by card or transfer." },
];

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {children}
    </span>
  );
}

/** A feature card: copy on top, a small illustrative mock-up underneath. */
function BentoCard({
  icon,
  tone,
  tint,
  title,
  text,
  span,
  children,
}: {
  icon: string;
  tone: string;
  tint: string;
  title: string;
  text: string;
  span: string;
  children: ReactNode;
}) {
  return (
    <li
      className={`group flex flex-col overflow-hidden rounded-3xl border border-outline-variant/70 bg-surface-container-lowest transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 ${span}`}
    >
      <div className="p-6 pb-4">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${tone}`}>
          <Icon name={icon} className="text-[24px]" />
        </span>
        <h3 className="mt-4 font-display text-xl font-semibold">{title}</h3>
        <p className="mt-1 font-body text-[14px] leading-relaxed text-on-surface-variant">{text}</p>
      </div>
      <div aria-hidden className={`mt-auto bg-gradient-to-b p-5 pt-4 ${tint}`}>
        <div className="rounded-2xl border border-outline-variant/60 bg-white p-3.5 shadow-sm transition-transform group-hover:scale-[1.02]">
          {children}
        </div>
      </div>
    </li>
  );
}

function FeatureBento() {
  return (
    <ul className="mt-10 grid gap-4 md:grid-cols-6">
      <BentoCard
        span="md:col-span-2"
        icon="event_available"
        tone="from-sky-500 to-blue-600"
        tint="from-sky-50/0 to-sky-100/70"
        title="Site inspections"
        text="Take booking requests online, confirm a time and send the right person."
      >
        <p className="font-body text-[11px] font-semibold text-on-surface-variant">Booking request</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {[
            { label: "Mon 9–11", on: false },
            { label: "Tue 1–3", on: true },
            { label: "Wed 8–10", on: false },
            { label: "Thu 2–4", on: false },
          ].map((slot) => (
            <span
              key={slot.label}
              className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-body text-[11px] font-semibold ${
                slot.on ? "bg-primary text-white" : "bg-surface-container-low text-on-surface-variant"
              }`}
            >
              {slot.on ? <Icon name="check" className="text-[13px]" /> : null}
              {slot.label}
            </span>
          ))}
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 font-body text-[11px] font-semibold text-emerald-700">
          <Icon name="person_pin_circle" className="text-[14px]" />
          Assigned to your inspector
        </p>
      </BentoCard>

      <BentoCard
        span="md:col-span-2"
        icon="request_quote"
        tone="from-violet-500 to-purple-600"
        tint="from-violet-50/0 to-violet-100/70"
        title="Quotations"
        text="Line items, GST and deposits, ready to send and easy for customers to accept."
      >
        <div className="space-y-1.5 font-body text-[11px]">
          {[
            ["Switchboard upgrade", "$1,800.00"],
            ["Labour · 6 h", "$480.00"],
            ["Materials", "$200.00"],
          ].map(([item, price]) => (
            <div key={item} className="flex justify-between text-on-surface-variant">
              <span>{item}</span>
              <span className="font-mono">{price}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-outline-variant/60 pt-1.5 text-[12px] font-bold text-on-surface">
            <span>Total (incl. GST)</span>
            <span className="font-mono">$2,480.00</span>
          </div>
        </div>
        <p className="mt-2.5 flex items-center justify-between rounded-lg bg-violet-50 px-2.5 py-1.5 font-body text-[11px] font-semibold text-violet-700">
          <span>Deposit requested · 20%</span>
          <span className="font-mono">$496.00</span>
        </p>
      </BentoCard>

      <BentoCard
        span="md:col-span-2"
        icon="receipt_long"
        tone="from-emerald-500 to-teal-600"
        tint="from-emerald-50/0 to-emerald-100/70"
        title="Invoices and payments"
        text="Turn an accepted quote into an invoice and get paid by card or bank transfer."
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] font-semibold text-emerald-700">INV 01 0007</span>
          <Pill tone="bg-emerald-100 text-emerald-700">Paid</Pill>
        </div>
        <p className="mt-1 font-display text-[22px] font-semibold">$2,480.00</p>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-container-low px-2 py-1.5 font-body text-[11px] font-semibold text-on-surface">
            <Icon name="credit_card" className="text-[15px] text-primary" />
            Card
          </span>
          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-container-low px-2 py-1.5 font-body text-[11px] font-semibold text-on-surface">
            <Icon name="account_balance" className="text-[15px] text-primary" />
            Bank transfer
          </span>
        </div>
      </BentoCard>

      <BentoCard
        span="md:col-span-3"
        icon="assignment"
        tone="from-amber-500 to-orange-600"
        tint="from-amber-50/0 to-amber-100/70"
        title="Jobs and calendar"
        text="Schedule your team, track every job and keep the whole week on one run sheet."
      >
        <div className="grid grid-cols-5 gap-1.5 font-body text-[10px] font-semibold text-on-surface-variant">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
            <span key={day} className="text-center">{day}</span>
          ))}
          {[
            ["bg-sky-200", "bg-transparent", "bg-violet-200", "bg-transparent", "bg-emerald-200"],
            ["bg-emerald-200", "bg-amber-200", "bg-transparent", "bg-sky-200", "bg-transparent"],
            ["bg-transparent", "bg-sky-200", "bg-emerald-200", "bg-violet-200", "bg-amber-200"],
          ].flatMap((row, r) =>
            row.map((color, c) => <span key={`${r}-${c}`} className={`h-6 rounded-md ${color}`} />),
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Pill tone="bg-sky-100 text-sky-700">Scheduled</Pill>
          <Pill tone="bg-emerald-100 text-emerald-700">On site</Pill>
          <Pill tone="bg-violet-100 text-violet-700">Quote visit</Pill>
          <Pill tone="bg-amber-100 text-amber-700">Pending</Pill>
        </div>
      </BentoCard>

      <BentoCard
        span="md:col-span-3"
        icon="group"
        tone="from-rose-500 to-pink-600"
        tint="from-rose-50/0 to-rose-100/70"
        title="Customers and team"
        text="Every customer's history in one place, with staff, attendance and leave managed alongside."
      >
        <div className="flex items-center justify-between">
          <div className="flex -space-x-2">
            {["bg-primary", "bg-violet-500", "bg-emerald-500", "bg-amber-500"].map((color, index) => (
              <span
                key={color}
                className={`flex h-8 w-8 items-center justify-center rounded-full font-body text-[11px] font-bold text-white ring-2 ring-white ${color}`}
              >
                {"ABCD"[index]}
              </span>
            ))}
          </div>
          <span className="font-body text-[11px] font-semibold text-on-surface-variant">Your team</span>
        </div>
        <ol className="mt-3 space-y-2 border-l-2 border-outline-variant/70 pl-3.5">
          {[
            { dot: "bg-violet-500", text: "Quote sent", meta: "Mon" },
            { dot: "bg-amber-500", text: "Job completed", meta: "Wed" },
            { dot: "bg-emerald-500", text: "Invoice paid", meta: "Fri" },
          ].map((event) => (
            <li key={event.text} className="relative flex items-center justify-between font-body text-[12px] text-on-surface">
              <span className={`absolute -left-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${event.dot}`} />
              {event.text}
              <span className="text-[11px] text-on-surface-variant">{event.meta}</span>
            </li>
          ))}
        </ol>
      </BentoCard>
    </ul>
  );
}

/** Illustrative product preview. Sample data only; not interactive. */
function HeroMockups() {
  return (
    <div aria-hidden className="relative mx-auto h-[420px] w-full max-w-md lg:max-w-none">
      <div className="absolute left-0 top-0 w-[88%] rounded-2xl border border-white/10 bg-white p-4 text-on-surface shadow-2xl shadow-black/40 sm:w-[78%]">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-display text-[15px] font-semibold">
            <Icon name="calendar_today" className="text-[18px] text-primary" />
            Today
          </p>
          <span className="font-body text-[11px] text-on-surface-variant">3 jobs</span>
        </div>
        <ul className="mt-3 space-y-2">
          {[
            { time: "8:00", job: "Switchboard upgrade", who: "Sample customer", pill: <Pill tone="bg-emerald-50 text-emerald-700">On site</Pill> },
            { time: "11:30", job: "Hot water service", who: "Sample customer", pill: <Pill tone="bg-sky-50 text-sky-700">Scheduled</Pill> },
            { time: "2:00", job: "Site inspection", who: "Sample customer", pill: <Pill tone="bg-amber-50 text-amber-700">Pending</Pill> },
          ].map((row) => (
            <li key={row.time} className="flex items-center gap-3 rounded-xl bg-surface-container-low px-3 py-2">
              <span className="w-10 font-mono text-[11px] font-semibold text-primary">{row.time}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-body text-[13px] font-semibold">{row.job}</span>
                <span className="block font-body text-[11px] text-on-surface-variant">{row.who}</span>
              </span>
              {row.pill}
            </li>
          ))}
        </ul>
      </div>

      <div className="absolute right-0 top-[150px] w-[74%] rounded-2xl border border-white/10 bg-white p-4 text-on-surface shadow-2xl shadow-black/40 sm:w-[60%]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] font-semibold text-violet-700">QT 01 0012</span>
          <Pill tone="bg-sky-50 text-sky-700">Sent</Pill>
        </div>
        <p className="mt-2 font-display text-[22px] font-semibold">$2,480.00</p>
        <p className="font-body text-[11px] text-on-surface-variant">Includes GST · deposit requested</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2">
          <Icon name="forward_to_inbox" className="text-[16px] text-violet-700" />
          <span className="font-body text-[11px] font-semibold text-violet-800">Emailed from your Gmail</span>
        </div>
      </div>

      <div className="absolute bottom-0 left-[6%] hidden w-[68%] rounded-2xl border border-white/10 bg-white p-3.5 text-on-surface shadow-2xl shadow-black/40 sm:block">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-body text-[11px] font-bold text-white">SC</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-[12px] font-semibold">Re: Quote QT 01 0012</p>
            <p className="truncate font-body text-[11px] text-on-surface-variant">Thanks, happy to go ahead with…</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-body text-[10px] font-semibold text-violet-700">
            <Icon name="request_quote" className="text-[12px]" />
            Quote
          </span>
        </div>
      </div>
    </div>
  );
}

/** Public home page: describes the product and links to the legal pages. */
export default function Home() {
  return (
    <PublicShell>
      {/* Signed-in owners go straight to their dashboard; everyone else sees this page. */}
      <LoginRedirect />
      <main>
        <section className="relative overflow-hidden bg-on-background text-inverse-on-surface">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-primary-container/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[380px] w-[380px] rounded-full bg-secondary/30 blur-3xl" />

          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 font-body text-[12px] font-semibold uppercase tracking-wider text-inverse-primary ring-1 ring-white/15">
                <Icon name="construction" className="text-[16px]" />
                Built for trade businesses
              </span>
              <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.1] sm:text-5xl lg:text-[56px]">
                Run your trade business in <span className="text-inverse-primary">one place</span>
              </h1>
              <p className="mt-5 max-w-xl font-body text-[17px] leading-relaxed text-outline-variant">
                {PRODUCT_NAME}{" "}brings site inspections, quotations, jobs, invoices,
                customers and email together, so you spend less time on paperwork
                and more on the work.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-6 py-3 font-body text-[15px] font-semibold text-white shadow-lg shadow-primary/30 transition-colors hover:bg-primary"
                >
                  Sign in
                  <Icon name="arrow_forward" className="text-[18px]" />
                </Link>
                <a
                  href="#how"
                  className="inline-flex items-center gap-2 rounded-xl px-6 py-3 font-body text-[15px] font-semibold text-inverse-on-surface ring-1 ring-white/25 transition-colors hover:bg-white/10"
                >
                  See how it works
                </a>
              </div>
            </div>
            <HeroMockups />
          </div>
        </section>

        <section className="border-b border-outline-variant/60 bg-surface-container-lowest">
          <ul className="mx-auto grid w-full max-w-6xl gap-4 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((item) => (
              <li key={item.text} className="flex items-center gap-3 font-body text-[13px] font-semibold text-on-surface">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon name={item.icon} className="text-[20px]" />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold">Everything a trade business runs on</h2>
            <p className="mt-3 font-body text-[16px] leading-relaxed text-on-surface-variant">
              From the first enquiry to the final payment, with no more juggling
              spreadsheets, paper job sheets and your inbox.
            </p>
          </div>
          <FeatureBento />
        </section>

        <section id="how" className="scroll-mt-20 bg-surface-container-low">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-semibold">From enquiry to paid, in four steps</h2>
            </div>
            <ol className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div
                aria-hidden
                className="absolute left-[12%] right-[12%] top-7 hidden border-t-2 border-dashed border-primary/30 lg:block"
              />
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative text-center">
                  <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/25">
                    <Icon name={step.icon} className="text-[26px]" />
                    <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-on-background font-body text-[12px] font-bold text-white ring-2 ring-surface-container-low">
                      {index + 1}
                    </span>
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold">{step.title}</h3>
                  <p className="mx-auto mt-1 max-w-[220px] font-body text-[14px] leading-relaxed text-on-surface-variant">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
              <Icon name="mail" className="text-[16px]" />
              Email
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight">
              Your own inbox, next to the work it belongs to
            </h2>
            <p className="mt-3 font-body text-[16px] leading-relaxed text-on-surface-variant">
              Connect your business Gmail and send quotes and invoices from your
              own address. Customer replies land in a mailbox built into the
              platform, labelled with the quote, invoice or job they relate to.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "Send quotes and invoices as PDFs from your Gmail address",
                "Reply, reply all and forward without leaving the platform",
                "See a customer's quotes, invoices and jobs beside their emails",
                "Disconnect at any time and your imported mail is removed",
              ].map((line) => (
                <li key={line} className="flex gap-2.5 font-body text-[14px] text-on-surface">
                  <Icon name="check_circle" className="mt-0.5 shrink-0 text-[19px] text-primary" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div aria-hidden className="relative">
            <div className="absolute -inset-3 -z-10 rounded-[28px] bg-gradient-to-br from-primary/15 via-violet-200/30 to-emerald-200/30 blur-xl" />
            <div className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-white shadow-xl shadow-primary/10">
              <div className="flex items-center gap-2 border-b border-outline-variant/50 bg-surface-container-low px-4 py-2.5">
                <Icon name="inbox" className="text-[18px] text-primary" />
                <span className="font-body text-[12px] font-semibold text-on-surface">Inbox</span>
                <span className="ml-auto rounded-full bg-primary px-2 py-0.5 font-body text-[10px] font-bold text-white">2 new</span>
              </div>
              {[
                { name: "Sample customer", subject: "Re: Quote QT 01 0012", chip: "Quote QT 01 0012", chipTone: "bg-violet-100 text-violet-700", edge: "border-l-violet-500", unread: true },
                { name: "Sample customer", subject: "Invoice INV 01 0004 received", chip: "Invoice INV 01 0004", chipTone: "bg-emerald-100 text-emerald-700", edge: "border-l-emerald-500", unread: true },
                { name: "Sample customer", subject: "Can you come Thursday?", chip: "Customer", chipTone: "bg-primary/10 text-primary", edge: "border-l-primary", unread: false },
              ].map((row, index) => (
                <div key={index} className={`flex items-start gap-3 border-l-4 px-4 py-3 ${row.edge} ${index > 0 ? "border-t border-t-outline-variant/40" : ""}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-body text-[11px] font-bold text-white">
                    {row.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-body text-[13px] text-on-surface ${row.unread ? "font-bold" : "font-medium"}`}>{row.name}</p>
                    <p className="truncate font-body text-[13px] text-on-surface">{row.subject}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 font-body text-[10px] font-semibold ${row.chipTone}`}>{row.chip}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-16">
          <div className="grid gap-6 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface-container-lowest to-surface-container-lowest p-6 sm:p-8 lg:grid-cols-[auto_1fr] lg:items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/25">
              <Icon name="verified_user" className="text-[28px]" />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold">How we use your Google account</h2>
              <p className="mt-2 font-body text-[14px] leading-relaxed text-on-surface-variant">
                If a business owner chooses to connect Gmail, {PRODUCT_NAME}{" "}uses
                that access only to send email from the owner&rsquo;s address and to
                show and manage the owner&rsquo;s own mailbox inside the platform.
                We never sell this data, use it for advertising or use it to train
                AI models. Owners can disconnect at any time. Read the full details
                in our{" "}
                <Link href="/privacy" className="font-semibold text-primary underline underline-offset-2">
                  Privacy Policy
                </Link>
                , which describes our use of Google user data, including our
                compliance with the Google API Services User Data Policy and its
                Limited Use requirements.
              </p>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-on-background text-inverse-on-surface">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary-container/30 blur-3xl" />
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-6 py-14 text-center">
            <h2 className="max-w-2xl font-display text-3xl font-semibold leading-tight">
              Spend less time on paperwork and more time on the work
            </h2>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-7 py-3 font-body text-[15px] font-semibold text-white shadow-lg shadow-primary/30 transition-colors hover:bg-primary"
            >
              Sign in
              <Icon name="arrow_forward" className="text-[18px]" />
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
