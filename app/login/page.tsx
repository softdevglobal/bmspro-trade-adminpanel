import { LoginForm } from "@/components/login-form";
import { LoginRedirect } from "@/components/login-redirect";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In - BMS Pro Trade",
  description: "Sign in to the BMS Pro Trade admin portal",
};

export default function LoginPage() {
  return (
    <>
      <LoginRedirect />
      <div className="flex min-h-dvh w-full flex-col overflow-x-hidden lg:min-h-screen lg:flex-row">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden lg:flex lg:w-1/2 lg:min-h-screen flex-col justify-between overflow-hidden bg-on-background p-8 xl:p-10 text-inverse-on-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-primary-container/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-[360px] w-[360px] rounded-full bg-secondary/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-container text-on-primary shadow-lg shadow-primary/30">
              <span className="material-symbols-outlined material-symbols-filled text-[24px]">
                architecture
              </span>
            </div>
            <span className="font-display text-[22px] font-bold tracking-tight text-inverse-primary">
              BMS Pro Trade
            </span>
          </div>

          <h1 className="font-display text-[28px] font-bold leading-[1.15] tracking-tight text-inverse-on-surface xl:text-[34px]">
            Run your trade
            <br />
            command center.
          </h1>
          <p className="mt-4 max-w-sm font-body text-body-md leading-relaxed text-outline-variant">
            Bookings, calendar, partners and service areas — all in one
            workspace built for receptions and operators.
          </p>
        </div>

        <div className="relative grid grid-cols-2 gap-3">
          <FeatureCard
            icon="calendar_today"
            label="Today"
            description="Live run sheet"
          />
          <FeatureCard
            icon="assignment"
            label="Bookings"
            description="Intake to invoice"
          />
          <FeatureCard
            icon="travel_explore"
            label="Service area"
            description="Radius validated"
          />
          <FeatureCard
            icon="handshake"
            label="Partners"
            description="Coverage & jobs"
          />
        </div>
      </aside>

      {/* Login form panel */}
      <main className="relative flex w-full flex-1 flex-col bg-background lg:w-1/2 lg:min-h-screen">
        <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 lg:min-h-0 lg:px-gutter lg:py-10">
          <div className="mx-auto w-full max-w-[420px]">
            <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                  architecture
                </span>
              </div>
              <span className="font-display text-headline-sm text-headline-sm font-bold text-primary">
                BMS Pro Trade
              </span>
            </div>

            <header className="mb-6 text-center lg:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 font-body text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Admin Portal
              </span>
              <h2 className="mt-3 font-display text-[26px] font-semibold text-on-surface sm:text-display-md">
                Welcome back
              </h2>
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                Sign in to manage bookings, teams and service areas.
              </p>
            </header>

            <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)] sm:p-6">
              <LoginForm />
            </div>

            <p className="mt-5 flex items-center justify-center gap-1.5 font-body text-[13px] text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px] text-outline">
                shield_lock
              </span>
              Secured by BMS Pro Trade
            </p>
          </div>
        </div>
      </main>
    </div>
    </>
  );
}

function FeatureCard({
  icon,
  label,
  description,
}: {
  icon: string;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-on-secondary-fixed-variant/40 bg-on-secondary-fixed-variant/15 p-3 backdrop-blur-sm">
      <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[20px] text-primary-fixed-dim">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-body text-[13px] font-semibold leading-tight text-inverse-on-surface">
          {label}
        </p>
        <p className="mt-0.5 font-body text-[12px] leading-tight text-outline-variant">
          {description}
        </p>
      </div>
    </div>
  );
}
