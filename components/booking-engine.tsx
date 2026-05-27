"use client";

import type { BookingBusiness } from "@/app/booknow/[slug]/page";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

type Props = {
  business: BookingBusiness;
};

const STATS = [
  {
    icon: "schedule",
    label: "Avg response",
    value: "< 30 min",
    accent: "text-amber-700",
    tintFrom: "rgba(255,222,185,0.55)",
  },
  {
    icon: "verified_user",
    label: "Verified pros",
    value: "100%",
    accent: "text-emerald-700",
    tintFrom: "rgba(206,228,212,0.55)",
  },
  {
    icon: "star",
    label: "Customer rating",
    value: "4.9/5",
    accent: "text-rose-700",
    tintFrom: "rgba(255,210,210,0.55)",
  },
] as const;

const STEPS = [
  {
    icon: "edit_note",
    title: "Tell us the job",
    description: "Share your trade need, location and a preferred time.",
  },
  {
    icon: "schedule_send",
    title: "We confirm",
    description: "The team reviews and confirms your booking in minutes.",
  },
  {
    icon: "engineering",
    title: "Get it sorted",
    description: "A vetted local pro shows up on time and gets the job done.",
  },
] as const;

export function BookingEngine({ business }: Props) {
  const reducedMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  const location = useMemo(() => {
    if (business.state && business.postcode) {
      return `${business.state}, ${business.postcode}`;
    }
    return business.state ?? "";
  }, [business.state, business.postcode]);

  const phoneHref = business.businessPhone
    ? `tel:+61${business.businessPhone.replace(/\s+/g, "")}`
    : null;
  const emailHref = business.businessEmail
    ? `mailto:${business.businessEmail}`
    : null;

  async function handleShare() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    try {
      if (typeof nav.share === "function") {
        await nav.share({
          title: business.businessName,
          text: `Book ${business.businessName} on BMS Pro Trade`,
          url,
        });
        return;
      }
      await nav.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* user cancelled */
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fbf8f3] text-on-surface">
      <AnimatedBackdrop reducedMotion={!!reducedMotion} />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10">
        <TopBar onShare={handleShare} copied={copied} />

        {/* Hero split */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-8 overflow-hidden rounded-[32px] border border-white/80 bg-white/85 p-6 shadow-[0_24px_60px_-24px_rgba(31,29,26,0.18)] backdrop-blur-xl sm:p-10"
        >
          <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <HeroContent
              business={business}
              location={location}
              reducedMotion={!!reducedMotion}
            />
            <RadarVisualization
              business={business}
              reducedMotion={!!reducedMotion}
            />
          </div>

          <div className="relative mt-10">
            <BookingCta
              businessName={business.businessName}
              reducedMotion={!!reducedMotion}
              phoneHref={phoneHref}
              emailHref={emailHref}
            />
          </div>
        </motion.section>

        <StatsStrip reducedMotion={!!reducedMotion} />

        <HowItWorks reducedMotion={!!reducedMotion} />

        <BookingFooter
          business={business}
          phoneHref={phoneHref}
          emailHref={emailHref}
        />
      </div>
    </main>
  );
}

/* ==========================================================================
 * Top bar
 * ========================================================================== */

function TopBar({
  onShare,
  copied,
}: {
  onShare: () => void;
  copied: boolean;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="flex items-center justify-between"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
          bolt
        </span>
        <span className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
          BMS Pro Trade
        </span>
      </div>
      <button
        type="button"
        onClick={onShare}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-3 py-1.5 font-body text-[12px] font-semibold text-on-surface shadow-sm backdrop-blur transition-all hover:scale-105 hover:bg-white"
      >
        <span className="material-symbols-outlined text-[16px]">
          {copied ? "check" : "ios_share"}
        </span>
        {copied ? "Link copied" : "Share"}
      </button>
    </motion.header>
  );
}

/* ==========================================================================
 * Hero content (left side)
 * ========================================================================== */

function HeroContent({
  business,
  location,
  reducedMotion,
}: {
  business: BookingBusiness;
  location: string;
  reducedMotion: boolean;
}) {
  const containerVariants = {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.07, delayChildren: 0.1 },
    },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
    },
  };

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show">
      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-stone-700 shadow-sm">
          <span className="material-symbols-outlined material-symbols-filled text-[14px] text-amber-700">
            {iconForBusinessType(business.businessType)}
          </span>
          {business.businessType}
        </span>
        <AvailableBadge active={business.isActive} reducedMotion={reducedMotion} />
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-4 font-display text-[34px] font-bold leading-[1.05] tracking-tight text-on-surface sm:text-[48px]"
      >
        Book{" "}
        <span className="relative inline-block">
          <span className="relative z-10 text-on-surface">
            {business.businessName}
          </span>
          {!reducedMotion && (
            <motion.span
              aria-hidden
              initial={{ scaleX: 0, originX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
              className="absolute -bottom-1 left-0 h-[6px] w-full rounded-full bg-primary/25"
            />
          )}
        </span>
      </motion.h1>

      <motion.p
        variants={itemVariants}
        className="mt-3 font-body text-body-lg text-on-surface-variant"
      >
        Local trade pros, online booking, no callbacks. Pick a time and
        we&apos;ll confirm in minutes.
      </motion.p>

      {(location || business.businessAddress) && (
        <motion.div
          variants={itemVariants}
          className="mt-5 inline-flex items-start gap-2.5 rounded-2xl border border-outline-variant/60 bg-white/70 px-4 py-3 backdrop-blur"
        >
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-primary">
            location_on
          </span>
          <div className="font-body text-body-md leading-tight">
            {business.businessAddress ? (
              <p className="font-semibold text-on-surface">
                {business.businessAddress}
              </p>
            ) : null}
            {location ? (
              <p className="text-on-surface-variant">{location}</p>
            ) : null}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function AvailableBadge({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean;
}) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
        <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant/60" />
        Unavailable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-semibold text-emerald-700">
      <span className="relative flex h-1.5 w-1.5">
        {!reducedMotion && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 2.4 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-0 rounded-full bg-emerald-500"
          />
        )}
        <span className="relative h-full w-full rounded-full bg-emerald-500" />
      </span>
      Booking now
    </span>
  );
}

/* ==========================================================================
 * Radar visualization (right side of hero)
 * ========================================================================== */

function RadarVisualization({
  business,
  reducedMotion,
}: {
  business: BookingBusiness;
  reducedMotion: boolean;
}) {
  const areas = business.serviceAreas.slice(0, 6);
  const [activeArea, setActiveArea] = useState(0);

  // Cycle through suburbs
  useEffect(() => {
    if (reducedMotion || areas.length === 0) return;
    const id = window.setInterval(() => {
      setActiveArea((i) => (i + 1) % areas.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [reducedMotion, areas.length]);

  const placements = useMemo(() => {
    return areas.map((area, idx) => {
      const angle = (idx / Math.max(areas.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 0.35 + ((idx % 2) * 0.05);
      return {
        area,
        x: 50 + Math.cos(angle) * radius * 100,
        y: 50 + Math.sin(angle) * radius * 100,
      };
    });
  }, [areas]);

  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-[400px] items-center justify-center">
      {/* Concentric grid rings - warm neutral */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(180,150,110,0.12)" />
            <stop offset="100%" stopColor="rgba(180,150,110,0)" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="95" fill="url(#radarGrad)" />
        {[30, 55, 80, 95].map((r) => (
          <circle
            key={r}
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="rgba(124,94,58,0.22)"
            strokeWidth="1"
            strokeDasharray={r === 95 ? "0" : "3 3"}
          />
        ))}
        <line
          x1="5"
          y1="100"
          x2="195"
          y2="100"
          stroke="rgba(124,94,58,0.18)"
          strokeWidth="0.6"
        />
        <line
          x1="100"
          y1="5"
          x2="100"
          y2="195"
          stroke="rgba(124,94,58,0.18)"
          strokeWidth="0.6"
        />
      </svg>

      {/* Sweep - warm amber tint */}
      {!reducedMotion && (
        <motion.div
          aria-hidden
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 [mask:radial-gradient(circle,black,transparent_70%)]"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(217,164,86,0.18) 30deg, transparent 60deg, transparent 360deg)",
            borderRadius: "9999px",
          }}
        />
      )}

      {/* Center pulse */}
      <div className="relative z-10 flex h-20 w-20 items-center justify-center">
        {!reducedMotion && (
          <>
            <motion.span
              aria-hidden
              initial={{ opacity: 0.4, scale: 0.7 }}
              animate={{ opacity: 0, scale: 1.7 }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
              className="absolute inset-0 rounded-full bg-primary/35"
            />
            <motion.span
              aria-hidden
              initial={{ opacity: 0.35, scale: 0.7 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{
                duration: 2.6,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.7,
              }}
              className="absolute inset-0 rounded-full bg-primary/35"
            />
          </>
        )}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/85 text-on-primary shadow-[0_10px_30px_-10px_rgba(67,123,255,0.55)]">
          <span className="material-symbols-outlined material-symbols-filled text-[28px]">
            {iconForBusinessType(business.businessType)}
          </span>
        </div>
      </div>

      {/* Pins */}
      {placements.map((pin, idx) => (
        <motion.button
          key={pin.area}
          type="button"
          onClick={() => setActiveArea(idx)}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: 0.4 + idx * 0.08,
            duration: 0.4,
            ease: "easeOut",
          }}
          whileHover={reducedMotion ? undefined : { scale: 1.15 }}
          className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
        >
          <span
            className={`relative flex items-center gap-1 rounded-full border px-2.5 py-1 font-body text-[11px] font-bold transition-all ${
              activeArea === idx
                ? "border-primary bg-primary text-on-primary shadow-md"
                : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            {!reducedMotion && activeArea === idx && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 2 }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                className="absolute inset-0 rounded-full bg-primary/45"
              />
            )}
            <span
              className={`material-symbols-outlined material-symbols-filled text-[12px] ${
                activeArea === idx ? "text-on-primary" : "text-stone-500"
              }`}
            >
              place
            </span>
            {pin.area}
          </span>
        </motion.button>
      ))}

      {areas.length === 0 ? (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 font-body text-[11px] text-on-surface-variant">
          Service area coming soon
        </p>
      ) : (
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-stone-200 bg-white/95 px-3 py-1 font-body text-[11px] font-semibold text-stone-700 backdrop-blur">
          Covering {areas.length} {areas.length === 1 ? "area" : "areas"}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * Booking CTA
 * ========================================================================== */

function BookingCta({
  businessName,
  phoneHref,
  emailHref,
  reducedMotion,
}: {
  businessName: string;
  phoneHref: string | null;
  emailHref: string | null;
  reducedMotion: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-primary/30 bg-gradient-to-br from-primary via-primary to-primary/85 p-6 text-on-primary shadow-[0_24px_50px_-20px_rgba(67,123,255,0.45)] sm:p-8">
      {!reducedMotion && (
        <>
          <motion.div
            aria-hidden
            initial={{ x: -120, y: -120, scale: 0.8 }}
            animate={{ x: -80, y: -100, scale: 1 }}
            transition={{
              duration: 4,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
            }}
            className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-on-primary/12 blur-3xl"
          />
          <motion.div
            aria-hidden
            initial={{ x: 80, y: 80, scale: 1 }}
            animate={{ x: 40, y: 60, scale: 1.15 }}
            transition={{
              duration: 5,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
            }}
            className="pointer-events-none absolute -bottom-20 -right-10 h-72 w-72 rounded-full bg-on-primary/12 blur-3xl"
          />
        </>
      )}

      <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <div className="flex items-center gap-2 font-body text-[11px] font-bold uppercase tracking-wider text-on-primary/80">
            <span className="material-symbols-outlined material-symbols-filled text-[14px]">
              event_available
            </span>
            Booking engine
          </div>
          <h3 className="mt-2 font-display text-headline-sm font-semibold sm:text-headline-md">
            Request a booking with {businessName}
          </h3>
          <p className="mt-1 font-body text-body-md text-on-primary/85">
            The customer booking form is launching soon. In the meantime,
            reach out directly &mdash; usually replies within an hour.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <motion.button
            type="button"
            whileHover={reducedMotion ? undefined : { scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            disabled
            className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-on-primary px-5 py-3.5 font-body text-label-bold text-primary shadow-lg disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined material-symbols-filled text-[18px]">
              calendar_add_on
            </span>
            Start a booking
            <span className="ml-1 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              Soon
            </span>
          </motion.button>

          <div className="flex gap-3">
            {phoneHref ? (
              <motion.a
                href={phoneHref}
                whileHover={reducedMotion ? undefined : { scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-on-primary/40 bg-on-primary/10 px-4 py-2.5 font-body text-label-bold text-on-primary backdrop-blur transition-colors hover:bg-on-primary/20"
              >
                <span className="material-symbols-outlined material-symbols-filled text-[18px]">
                  call
                </span>
                Call
              </motion.a>
            ) : null}
            {emailHref ? (
              <motion.a
                href={emailHref}
                whileHover={reducedMotion ? undefined : { scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-on-primary/40 bg-on-primary/10 px-4 py-2.5 font-body text-label-bold text-on-primary backdrop-blur transition-colors hover:bg-on-primary/20"
              >
                <span className="material-symbols-outlined text-[18px]">
                  mail
                </span>
                Email
              </motion.a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * Stats strip
 * ========================================================================== */

function StatsStrip({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {STATS.map((stat, idx) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ delay: idx * 0.08, duration: 0.45, ease: "easeOut" }}
          whileHover={reducedMotion ? undefined : { y: -4 }}
          className="relative overflow-hidden rounded-2xl border border-white/80 bg-white/85 p-5 shadow-[0_10px_30px_-15px_rgba(31,29,26,0.15)] backdrop-blur-xl"
          style={{
            backgroundImage: `linear-gradient(135deg, ${stat.tintFrom} 0%, rgba(255,255,255,0) 60%)`,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ${stat.accent}`}
            >
              <span className="material-symbols-outlined material-symbols-filled text-[20px]">
                {stat.icon}
              </span>
            </div>
            <div>
              <p className="font-display text-[22px] font-bold text-on-surface">
                {stat.value}
              </p>
              <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                {stat.label}
              </p>
            </div>
          </div>
        </motion.div>
      ))}
    </motion.section>
  );
}

/* ==========================================================================
 * How it works
 * ========================================================================== */

function HowItWorks({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section className="mt-14">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 text-center"
      >
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
          How it works
        </p>
        <h2 className="mt-2 font-display text-headline-md font-semibold text-on-surface">
          Three steps. Done in minutes.
        </h2>
      </motion.div>

      <div className="relative grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* dotted connector — desktop only */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-[16%] right-[16%] top-12 hidden h-px md:block"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(67,123,255,0.35) 50%, transparent 0%)",
            backgroundSize: "10px 1px",
            backgroundRepeat: "repeat-x",
          }}
        />

        {STEPS.map((step, idx) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: idx * 0.1, duration: 0.5, ease: "easeOut" }}
            whileHover={reducedMotion ? undefined : { y: -4 }}
            className="relative rounded-2xl border border-stone-200/80 bg-white/90 p-6 text-center shadow-[0_10px_25px_-15px_rgba(31,29,26,0.15)] backdrop-blur-xl"
          >
            <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-stone-900 to-stone-800 text-white shadow-lg">
              <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                {step.icon}
              </span>
              <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary font-body text-[11px] font-bold text-on-primary">
                {idx + 1}
              </span>
            </div>
            <h3 className="mt-4 font-display text-[16px] font-semibold text-on-surface">
              {step.title}
            </h3>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {step.description}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ==========================================================================
 * Footer
 * ========================================================================== */

function BookingFooter({
  business,
  phoneHref,
  emailHref,
}: {
  business: BookingBusiness;
  phoneHref: string | null;
  emailHref: string | null;
}) {
  const year = new Date().getFullYear();
  const phoneDisplay = business.businessPhone
    ? `+61 ${business.businessPhone}`
    : null;
  const locationParts = [
    business.businessAddress,
    [business.state, business.postcode].filter(Boolean).join(" "),
  ].filter((p): p is string => Boolean(p && p.trim()));

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative mt-14 overflow-hidden rounded-[28px] border border-stone-200 bg-white/90 p-8 shadow-[0_10px_30px_-20px_rgba(31,29,26,0.15)] backdrop-blur-xl sm:p-10"
    >
      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/85 text-on-primary shadow-md">
              <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                {iconForBusinessType(business.businessType)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold text-on-surface">
                {business.businessName}
              </p>
              <p className="font-body text-[12px] text-on-surface-variant">
                {business.businessType}
              </p>
            </div>
          </div>
          <p className="mt-4 font-body text-body-md text-on-surface-variant">
            Trusted local trade pros — book online, get the job done.
          </p>
        </div>

        <div>
          <h4 className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Get in touch
          </h4>
          <ul className="mt-3 space-y-2.5 font-body text-body-md text-on-surface">
            {phoneHref && phoneDisplay ? (
              <li>
                <a
                  href={phoneHref}
                  className="inline-flex items-center gap-2 transition-colors hover:text-amber-700"
                >
                  <span className="material-symbols-outlined text-[16px] text-amber-700">
                    call
                  </span>
                  {phoneDisplay}
                </a>
              </li>
            ) : null}
            {emailHref && business.businessEmail ? (
              <li>
                <a
                  href={emailHref}
                  className="inline-flex items-center gap-2 break-all transition-colors hover:text-amber-700"
                >
                  <span className="material-symbols-outlined text-[16px] text-amber-700">
                    mail
                  </span>
                  {business.businessEmail}
                </a>
              </li>
            ) : null}
            {locationParts.length > 0 ? (
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-700">
                  location_on
                </span>
                <span>
                  {locationParts.map((part) => (
                    <span key={part} className="block">
                      {part}
                    </span>
                  ))}
                </span>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <h4 className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Service promise
          </h4>
          <ul className="mt-3 space-y-2 font-body text-body-md text-on-surface">
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-emerald-700">
                verified
              </span>
              Verified, insured trade pros
            </li>
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-amber-700">
                schedule
              </span>
              Quick response, transparent pricing
            </li>
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-rose-700">
                shield_lock
              </span>
              Secure online bookings
            </li>
          </ul>
        </div>
      </div>

      <div className="my-8 h-px bg-gradient-to-r from-transparent via-stone-300 to-transparent" />

      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="font-body text-[12px] text-on-surface-variant">
          © {year} {business.businessName}. All rights reserved.
        </p>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-fixed px-3 py-1.5">
          <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
            bolt
          </span>
          <span className="font-body text-[11px] font-semibold text-primary">
            Powered by{" "}
            <span className="font-bold tracking-wide">BMS Pro Trade</span>
          </span>
        </div>
      </div>
    </motion.footer>
  );
}

/* ==========================================================================
 * Animated backdrop — mesh gradient + dot grid + drifting orbs
 * ========================================================================== */

function AnimatedBackdrop({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Soft cream-to-warm wash with a hint of brand blue */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(at 8% 12%, rgba(67,123,255,0.09) 0px, transparent 45%)," +
            "radial-gradient(at 92% 18%, rgba(255,210,180,0.38) 0px, transparent 50%)," +
            "radial-gradient(at 50% 95%, rgba(220,235,225,0.30) 0px, transparent 55%)",
        }}
      />

      {/* === Editorial / poster-style SVG composition === */}
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1200 900"
        fill="none"
      >
        <defs>
          <linearGradient id="bgBlobBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(67,123,255,0.18)" />
            <stop offset="100%" stopColor="rgba(67,123,255,0)" />
          </linearGradient>
          <linearGradient id="bgBlobPeach" x1="20%" y1="20%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,178,128,0.22)" />
            <stop offset="100%" stopColor="rgba(255,178,128,0)" />
          </linearGradient>
          <linearGradient id="bgBlobSage" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(160,200,170,0.22)" />
            <stop offset="100%" stopColor="rgba(160,200,170,0)" />
          </linearGradient>
        </defs>

        {/* Asymmetric organic shape — top-left (blue) */}
        <motion.path
          initial={{ opacity: 0.85 }}
          animate={reducedMotion ? undefined : { opacity: [0.7, 0.95, 0.7] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          d="M -120 -40 C 60 -110, 280 -60, 360 90 C 420 220, 280 320, 140 320 C 0 320, -160 240, -200 140 C -220 60, -200 -10, -120 -40 Z"
          fill="url(#bgBlobBlue)"
        />

        {/* Asymmetric organic shape — bottom-right (peach) */}
        <motion.path
          initial={{ opacity: 0.85 }}
          animate={reducedMotion ? undefined : { opacity: [0.75, 1, 0.75] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          d="M 1320 580 C 1180 480, 1000 540, 920 660 C 840 780, 920 920, 1080 940 C 1240 960, 1380 860, 1380 740 C 1380 660, 1380 620, 1320 580 Z"
          fill="url(#bgBlobPeach)"
        />

        {/* Small accent shape — middle-right (sage) */}
        <motion.path
          initial={{ opacity: 0.7 }}
          animate={reducedMotion ? undefined : { opacity: [0.55, 0.85, 0.55] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          d="M 1080 380 C 1140 360, 1180 420, 1160 470 C 1140 520, 1080 530, 1040 500 C 1000 470, 1020 400, 1080 380 Z"
          fill="url(#bgBlobSage)"
        />

        {/* === Topographic contour lines — flowing across upper-middle === */}
        <g
          stroke="rgba(67,123,255,0.22)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        >
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2, ease: "easeOut", delay: 0.1 }}
            d="M -50 200 C 200 160, 400 240, 600 200 C 800 160, 1000 220, 1260 180"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.85 }}
            transition={{ duration: 2.2, ease: "easeOut", delay: 0.25 }}
            d="M -50 240 C 200 200, 400 280, 600 240 C 800 200, 1000 260, 1260 220"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.6 }}
            transition={{ duration: 2.4, ease: "easeOut", delay: 0.4 }}
            d="M -50 280 C 200 240, 400 320, 600 280 C 800 240, 1000 300, 1260 260"
          />
        </g>

        {/* === Topographic contour lines — bottom (warm taupe) === */}
        <g
          stroke="rgba(180,140,90,0.28)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        >
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2.2, ease: "easeOut", delay: 0.5 }}
            d="M -50 700 C 200 740, 400 660, 600 700 C 800 740, 1000 680, 1260 720"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 2.4, ease: "easeOut", delay: 0.65 }}
            d="M -50 740 C 200 780, 400 700, 600 740 C 800 780, 1000 720, 1260 760"
          />
        </g>

        {/* === Sketchy zig-zag accent (top-right) === */}
        <motion.polyline
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.55 }}
          transition={{ duration: 1.6, ease: "easeOut", delay: 0.6 }}
          points="1000,80 1020,100 1040,80 1060,100 1080,80 1100,100 1120,80"
          stroke="rgba(67,123,255,0.55)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* === Triangle accent — middle-left === */}
        <motion.path
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 0.5, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.7 }}
          d="M 80 480 L 120 520 L 60 540 Z"
          fill="none"
          stroke="rgba(67,123,255,0.45)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* === Outlined square — rotated, top-right area === */}
        <motion.rect
          initial={{ opacity: 0, rotate: -10 }}
          animate={{ opacity: 0.45, rotate: 18 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.7 }}
          x="950"
          y="500"
          width="36"
          height="36"
          fill="none"
          stroke="rgba(180,140,90,0.55)"
          strokeWidth="1.2"
          style={{ transformOrigin: "968px 518px" }}
        />

        {/* === Long diagonal brush stroke (bottom-left) === */}
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.4 }}
          transition={{ duration: 2.2, ease: "easeOut", delay: 0.4 }}
          d="M -20 880 C 60 820, 140 800, 240 760"
          stroke="rgba(67,123,255,0.5)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* === Short dashed accent (top, near hero) === */}
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.55 }}
          transition={{ duration: 1.4, ease: "easeOut", delay: 0.9 }}
          d="M 540 60 L 620 60"
          stroke="rgba(67,123,255,0.55)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="4 6"
          fill="none"
        />

        {/* === Floating decorative marks: + signs === */}
        <g
          stroke="rgba(67,123,255,0.4)"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <PlusSign x={1080} y={380} size={6} />
          <PlusSign x={180} y={420} size={5} />
          <PlusSign x={420} y={140} size={4} />
          <PlusSign x={760} y={140} size={5} />
        </g>

        {/* === Tiny floating dots (warm) === */}
        <g fill="rgba(180,140,90,0.45)">
          <circle cx="780" cy="80" r="2.5" />
          <circle cx="1140" cy="280" r="2" />
          <circle cx="60" cy="380" r="2.5" />
          <circle cx="380" cy="640" r="2.5" />
        </g>

        {/* === Tiny floating dots (blue) === */}
        <g fill="rgba(67,123,255,0.45)">
          <circle cx="940" cy="220" r="2.5" />
          <circle cx="280" cy="80" r="2" />
          <circle cx="660" cy="780" r="2.5" />
        </g>

        {/* === Short tick marks like measuring lines (left edge) === */}
        <g
          stroke="rgba(67,123,255,0.3)"
          strokeWidth="1"
          strokeLinecap="round"
        >
          <line x1="40" y1="120" x2="56" y2="120" />
          <line x1="40" y1="160" x2="56" y2="160" />
          <line x1="40" y1="200" x2="56" y2="200" />
          <line x1="40" y1="240" x2="50" y2="240" />
        </g>
      </svg>

      {/* Soft watercolor drifts — subtle and slow */}
      {!reducedMotion && (
        <>
          <motion.div
            initial={{ x: -30, y: -20 }}
            animate={{ x: 40, y: 40 }}
            transition={{
              duration: 22,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
            }}
            className="absolute -top-20 left-[6%] h-72 w-[26rem] rounded-full bg-primary/10 blur-[110px]"
          />
          <motion.div
            initial={{ x: 30, y: 20 }}
            animate={{ x: -30, y: -20 }}
            transition={{
              duration: 26,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
            }}
            className="absolute -bottom-24 right-[5%] h-80 w-[30rem] rounded-full bg-[#ffd0a8]/50 blur-[120px]"
          />
        </>
      )}

      {/* Bottom fade for footer */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#fbf8f3] to-transparent" />
    </div>
  );
}

function PlusSign({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g>
      <line x1={x - size} y1={y} x2={x + size} y2={y} />
      <line x1={x} y1={y - size} x2={x} y2={y + size} />
    </g>
  );
}
