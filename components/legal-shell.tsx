import { PRODUCT_NAME } from "@/lib/legal/site";
import Link from "next/link";
import type { ReactNode } from "react";

/** Header and footer shared by the public pages. No sign-in is needed to view them. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-on-background">
      <header className="sticky top-0 z-20 border-b border-outline-variant/60 bg-surface-container-lowest/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bms_pro_blue.jpeg" alt="" width={36} height={36} className="h-9 w-9 rounded-lg object-cover" />
            <span className="font-display text-[17px] font-semibold">{PRODUCT_NAME}</span>
          </Link>
          <nav aria-label="Legal" className="hidden items-center gap-1 sm:flex">
            <Link className="rounded-lg px-3 py-2 font-body text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface" href="/privacy">Privacy</Link>
            <Link className="rounded-lg px-3 py-2 font-body text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface" href="/terms">Terms</Link>
          </nav>
          <Link
            href="/login"
            className="rounded-xl bg-primary px-4 py-2 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-outline-variant/60 bg-surface-container-lowest">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 font-body text-[13px] text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {PRODUCT_NAME}</p>
          <nav aria-label="Legal links" className="flex flex-wrap gap-x-5 gap-y-1">
            <Link className="hover:text-primary hover:underline" href="/privacy">Privacy Policy</Link>
            <Link className="hover:text-primary hover:underline" href="/terms">Terms of Service</Link>
            <Link className="hover:text-primary hover:underline" href="/security">Security</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export type GlanceItem = { icon: string; title: string; text: string };
export type TocItem = { id: string; title: string; icon: string };

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={`material-symbols-outlined ${className}`}>
      {name}
    </span>
  );
}

/**
 * A legal page with a banner, "at a glance" cards and a sticky contents list.
 * Everything is server-rendered, so it reads fine without JavaScript.
 */
export function LegalDocument({
  icon,
  eyebrow,
  title,
  intro,
  updated,
  glance,
  toc,
  children,
}: {
  icon: string;
  eyebrow: string;
  title: string;
  intro: string;
  updated: string;
  glance: GlanceItem[];
  toc: TocItem[];
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <section className="relative overflow-hidden bg-on-background text-inverse-on-surface">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary-container/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-secondary/30 blur-3xl" />
        <div className="relative mx-auto w-full max-w-6xl px-6 pb-20 pt-14">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 font-body text-[12px] font-semibold uppercase tracking-wider text-inverse-primary ring-1 ring-white/15">
            <Icon name={icon} className="text-[16px]" />
            {eyebrow}
          </span>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl font-body text-[16px] leading-relaxed text-outline-variant">{intro}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 font-body text-[12px] text-outline-variant">
            <Icon name="update" className="text-[15px]" />
            Last updated {updated}
          </p>
        </div>
      </section>

      <div className="relative mx-auto -mt-10 w-full max-w-6xl px-6">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {glance.map((item) => (
            <li key={item.title} className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-4 shadow-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon name={item.icon} className="text-[22px]" />
              </span>
              <p className="mt-3 font-display text-[15px] font-semibold text-on-background">{item.title}</p>
              <p className="mt-1 font-body text-[13px] leading-relaxed text-on-surface-variant">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="group rounded-2xl border border-outline-variant/70 bg-surface-container-lowest lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-body text-[14px] font-semibold">
              On this page
              <Icon name="expand_more" className="text-[20px] transition-transform group-open:rotate-180" />
            </summary>
            <TocList toc={toc} />
          </details>
          <nav aria-label="On this page" className="hidden lg:block">
            <p className="px-3 pb-2 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">On this page</p>
            <TocList toc={toc} />
          </nav>
        </aside>

        <main className="min-w-0 space-y-6 font-body text-[15px] leading-relaxed text-on-surface-variant">{children}</main>
      </div>
    </PublicShell>
  );
}

function TocList({ toc }: { toc: TocItem[] }) {
  return (
    <ol className="space-y-0.5 p-2">
      {toc.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-body text-[13px] font-medium text-on-surface-variant transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <Icon name={item.icon} className="text-[18px]" />
            {item.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function LegalSection({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-6">
      <h2 className="flex items-center gap-3 font-display text-xl font-semibold text-on-background">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon name={icon} className="text-[20px]" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <Icon name="check_circle" className="mt-0.5 shrink-0 text-[18px] text-primary" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A highlighted statement, e.g. the Google Limited Use commitment. */
export function Callout({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-surface-container-lowest to-surface-container-lowest p-4">
      <p className="flex items-center gap-2 font-display text-[15px] font-semibold text-on-background">
        <Icon name={icon} className="text-[20px] text-primary" />
        {title}
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}
