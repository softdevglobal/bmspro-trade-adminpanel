"use client";

import type { BookingBusiness, BookingService } from "@/app/booknow/[slug]/page";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

type Props = {
  business: BookingBusiness;
  services: BookingService[];
};

export type ServiceAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

function formatServiceAddress(address: ServiceAddress): string {
  return [address.street, address.suburb, address.state, address.postcode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function isServiceAddressComplete(address: ServiceAddress): boolean {
  return (
    address.street.trim().length >= 3 &&
    address.suburb.trim().length >= 2 &&
    address.state.trim().length >= 2 &&
    address.postcode.trim().length >= 4
  );
}

export function BookingEngine({ business, services }: Props) {
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
            <ServiceBookingFlow
              businessName={business.businessName}
              services={services}
              reducedMotion={!!reducedMotion}
              phoneHref={phoneHref}
              emailHref={emailHref}
            />
          </div>
        </motion.section>

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
      {/* Concentric grid rings — brand blue */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(67,123,255,0.14)" />
            <stop offset="100%" stopColor="rgba(67,123,255,0)" />
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
            stroke="rgba(67,123,255,0.28)"
            strokeWidth="1"
            strokeDasharray={r === 95 ? "0" : "3 3"}
          />
        ))}
        <line
          x1="5"
          y1="100"
          x2="195"
          y2="100"
          stroke="rgba(67,123,255,0.2)"
          strokeWidth="0.6"
        />
        <line
          x1="100"
          y1="5"
          x2="100"
          y2="195"
          stroke="rgba(67,123,255,0.2)"
          strokeWidth="0.6"
        />
      </svg>

      {/* Rotating sweep — brand blue */}
      {!reducedMotion && (
        <motion.div
          aria-hidden
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 [mask:radial-gradient(circle,black,transparent_70%)]"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(67,123,255,0.22) 30deg, transparent 60deg, transparent 360deg)",
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
 * Service booking flow — address first, then service
 * ========================================================================== */

const EMPTY_ADDRESS: ServiceAddress = {
  street: "",
  suburb: "",
  state: "",
  postcode: "",
};

const BOOKING_INPUT_CLASS =
  "mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 font-body text-[14px] text-on-surface shadow-sm placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10";

function ServiceBookingFlow({
  businessName,
  services,
  phoneHref,
  emailHref,
  reducedMotion,
}: {
  businessName: string;
  services: BookingService[];
  phoneHref: string | null;
  emailHref: string | null;
  reducedMotion: boolean;
}) {
  const [address, setAddress] = useState<ServiceAddress>(EMPTY_ADDRESS);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const addressComplete = isServiceAddressComplete(address);
  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;
  const canContinue = addressComplete && selectedService !== null;

  function updateAddress<K extends keyof ServiceAddress>(key: K, value: string) {
    setAddress((prev) => ({ ...prev, [key]: value }));
    setSubmitted(false);
  }

  function handleContinue() {
    if (!canContinue) return;
    setSubmitted(true);
  }

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-stone-200/90 bg-white/95 p-6 shadow-[0_12px_40px_-18px_rgba(31,29,26,0.14)] sm:p-8">
      <div className="relative space-y-6 text-on-surface">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-[#faf8f5] px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-stone-600">
            <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
              event_available
            </span>
            Book online
          </div>
          <h3 className="mt-3 font-display text-headline-sm font-semibold text-on-surface sm:text-headline-md">
            Book a service with {businessName}
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Browse services below, then add your address to continue booking.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-[#faf8f5] p-4 sm:p-5">
          <BookingStepHeader
            step={1}
            title="Service address"
            hint="Required"
            active
          />
          <p className="mt-2 font-body text-[13px] text-on-surface-variant">
            Where should our team carry out this job?
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Street address
              </span>
              <input
                type="text"
                value={address.street}
                onChange={(e) => updateAddress("street", e.target.value)}
                placeholder="e.g. 12 Main Street"
                autoComplete="street-address"
                className={BOOKING_INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Suburb
              </span>
              <input
                type="text"
                value={address.suburb}
                onChange={(e) => updateAddress("suburb", e.target.value)}
                placeholder="e.g. Kandy"
                autoComplete="address-level2"
                className={BOOKING_INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                State
              </span>
              <input
                type="text"
                value={address.state}
                onChange={(e) => updateAddress("state", e.target.value)}
                placeholder="e.g. NSW"
                autoComplete="address-level1"
                className={BOOKING_INPUT_CLASS}
              />
            </label>
            <label className="block sm:col-span-2 sm:max-w-[12rem]">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Postcode
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={address.postcode}
                onChange={(e) => updateAddress("postcode", e.target.value)}
                placeholder="e.g. 2000"
                autoComplete="postal-code"
                className={BOOKING_INPUT_CLASS}
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-[#faf8f5] p-4 sm:p-5">
          <BookingStepHeader step={2} title="Choose a service" active />

          {services.length === 0 ? (
            <p className="mt-4 font-body text-body-md text-on-surface-variant">
              No services are available to book online yet. Please call or
              email the business directly.
            </p>
          ) : (
            <ul className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              {services.map((service, index) => (
                <li
                  key={service.id}
                  className={index > 0 ? "border-t border-stone-200" : ""}
                >
                  <BookingServiceListItem
                    service={service}
                    selected={selectedServiceId === service.id}
                    onSelect={() => {
                      setSelectedServiceId((current) =>
                        current === service.id ? null : service.id,
                      );
                      setSubmitted(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {submitted && selectedService ? (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-body text-[13px] text-emerald-900"
          >
            <p className="font-semibold">Ready for scheduling</p>
            <p className="mt-1 text-emerald-800/90">
              <span className="font-semibold">{selectedService.name}</span> at{" "}
              {formatServiceAddress(address)}. Date &amp; time selection is
              coming soon — use Call or Email below to confirm now.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <motion.button
            type="button"
            whileHover={reducedMotion || !canContinue ? undefined : { scale: 1.02 }}
            whileTap={canContinue ? { scale: 0.98 } : undefined}
            disabled={!canContinue}
            onClick={handleContinue}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-body text-label-bold text-on-primary shadow-md transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="material-symbols-outlined material-symbols-filled text-[18px]">
              calendar_add_on
            </span>
            Continue booking
          </motion.button>

          <div className="flex gap-3">
            {phoneHref ? (
              <motion.a
                href={phoneHref}
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 font-body text-label-bold text-on-surface shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 sm:flex-none"
              >
                <span className="material-symbols-outlined material-symbols-filled text-[18px] text-stone-600">
                  call
                </span>
                Call
              </motion.a>
            ) : null}
            {emailHref ? (
              <motion.a
                href={emailHref}
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 font-body text-label-bold text-on-surface shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 sm:flex-none"
              >
                <span className="material-symbols-outlined text-[18px] text-stone-600">
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

function BookingStepHeader({
  step,
  title,
  hint,
  active,
}: {
  step: number;
  title: string;
  hint?: string;
  active: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full font-body text-[12px] font-bold ${
          active
            ? "bg-stone-800 text-white"
            : "bg-stone-200 text-stone-500"
        }`}
      >
        {step}
      </span>
      <h4 className="font-display text-[15px] font-semibold text-on-surface">
        {title}
      </h4>
      {hint ? (
        <span className="font-body text-[11px] text-on-surface-variant">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function BookingServiceListItem({
  service,
  selected,
  onSelect,
}: {
  service: BookingService;
  selected: boolean;
  onSelect: () => void;
}) {
  const [tasksOpen, setTasksOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const hasTasks = service.tasks.length > 0;
  const tasksTransition = reducedMotion
    ? { duration: 0.15 }
    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <div
      className={`transition-colors ${
        selected ? "bg-primary-fixed/25" : "bg-white hover:bg-stone-50/80"
      }`}
    >
      <div className="flex items-stretch gap-3 p-3 sm:gap-4 sm:p-4">
        <div className="relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-xl bg-stone-100 sm:h-20 sm:w-20">
          {service.imageUrl ? (
            <img
              src={service.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200">
              <span className="material-symbols-outlined material-symbols-filled text-[28px] text-stone-400 sm:text-[32px]">
                {service.skillIcon}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left"
        >
          <p className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-on-surface sm:text-[16px]">
            {service.name}
          </p>

          {service.businessType ? (
            <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">
                {service.skillIcon}
              </span>
              {service.businessType}
            </span>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 font-body text-[11px] font-semibold text-on-surface-variant">
            <span className="inline-flex items-center gap-0.5 text-on-surface">
              <span className="material-symbols-outlined text-[14px] text-primary">
                schedule
              </span>
              {service.durationLabel}
            </span>
            <span aria-hidden className="text-stone-300">
              ·
            </span>
            <span className="inline-flex items-center gap-0.5 text-on-surface">
              <span className="material-symbols-outlined text-[14px] text-primary">
                checklist
              </span>
              {service.taskCount} {service.taskCount === 1 ? "task" : "tasks"}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={onSelect}
          aria-label={selected ? "Selected service" : `Select ${service.name}`}
          className="flex shrink-0 items-center self-center"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
              selected
                ? "border-primary bg-primary text-on-primary"
                : "border-stone-300 bg-white text-transparent group-hover:border-stone-400"
            }`}
          >
            {selected ? (
              <span className="material-symbols-outlined material-symbols-filled text-[16px]">
                check
              </span>
            ) : null}
          </span>
        </button>
      </div>

      {hasTasks ? (
        <>
          <button
            type="button"
            onClick={() => setTasksOpen((open) => !open)}
            aria-expanded={tasksOpen}
            className="flex w-full items-center justify-between gap-2 border-t border-stone-100 px-3 py-2.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-stone-50 sm:px-4"
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-primary">
                checklist
              </span>
              {`${tasksOpen ? "Hide" : "View"} what's included (${service.taskCount})`}
            </span>
            <motion.span
              animate={{ rotate: tasksOpen ? 180 : 0 }}
              transition={tasksTransition}
              className="material-symbols-outlined text-[20px] text-stone-500"
            >
              expand_more
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {tasksOpen ? (
              <motion.div
                key="tasks-panel"
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                animate={
                  reducedMotion
                    ? { opacity: 1 }
                    : { height: "auto", opacity: 1 }
                }
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                transition={tasksTransition}
                className="overflow-hidden"
              >
                <ul className="space-y-2.5 border-t border-stone-100 bg-[#faf8f5] px-3 py-3 sm:px-4 sm:py-3.5">
                  {service.tasks.map((task, index) => (
                    <motion.li
                      key={task.id}
                      initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        ...tasksTransition,
                        delay: reducedMotion ? 0 : 0.04 + index * 0.03,
                      }}
                      className="flex gap-2.5"
                    >
                      <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[15px] text-primary">
                        check_circle
                      </span>
                      <div className="min-w-0">
                        <p className="font-body text-[12px] font-semibold text-on-surface">
                          {task.title}
                        </p>
                        {task.description ? (
                          <p className="mt-0.5 font-body text-[11px] leading-snug text-on-surface-variant">
                            {task.description}
                          </p>
                        ) : null}
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </div>
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
