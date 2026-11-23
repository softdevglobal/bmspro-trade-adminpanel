import { ActivationForm } from "@/components/activation-form";
import { getActivationPreview } from "@/lib/auth/activation";

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await getActivationPreview(token).catch(() => null);
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fbf8f3] p-4 sm:p-6">
      {/* Same soft backdrop as the booking page: cream wash with blue, peach and sage glows. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(at 8% 12%, rgba(67,123,255,0.09) 0px, transparent 45%)," +
            "radial-gradient(at 92% 18%, rgba(255,210,180,0.38) 0px, transparent 50%)," +
            "radial-gradient(at 50% 95%, rgba(220,235,225,0.30) 0px, transparent 55%)",
        }}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1200 900"
        fill="none"
      >
        <defs>
          <linearGradient id="actBlobBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(67,123,255,0.18)" />
            <stop offset="100%" stopColor="rgba(67,123,255,0)" />
          </linearGradient>
          <linearGradient id="actBlobPeach" x1="20%" y1="20%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,178,128,0.22)" />
            <stop offset="100%" stopColor="rgba(255,178,128,0)" />
          </linearGradient>
          <linearGradient id="actBlobSage" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(160,200,170,0.22)" />
            <stop offset="100%" stopColor="rgba(160,200,170,0)" />
          </linearGradient>
        </defs>
        <path
          d="M -120 -40 C 60 -110, 280 -60, 360 90 C 420 220, 280 320, 140 320 C 0 320, -160 240, -200 140 C -220 60, -200 -10, -120 -40 Z"
          fill="url(#actBlobBlue)"
        />
        <path
          d="M 1320 580 C 1180 480, 1000 540, 920 660 C 840 780, 920 920, 1080 940 C 1240 960, 1380 860, 1380 740 C 1380 660, 1380 620, 1320 580 Z"
          fill="url(#actBlobPeach)"
        />
        <path
          d="M 1080 380 C 1140 360, 1180 420, 1160 470 C 1140 520, 1080 530, 1040 500 C 1000 470, 1020 400, 1080 380 Z"
          fill="url(#actBlobSage)"
        />
        <g stroke="rgba(67,123,255,0.22)" strokeWidth="1" fill="none" strokeLinecap="round">
          <path d="M -50 200 C 200 160, 400 240, 600 200 C 800 160, 1000 220, 1260 180" />
          <path d="M -50 240 C 200 200, 400 280, 600 240 C 800 200, 1000 260, 1260 220" />
        </g>
      </svg>
      <ActivationForm token={token} preview={preview} />
    </main>
  );
}
