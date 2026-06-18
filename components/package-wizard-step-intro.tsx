export function PackageWizardStepIntro({
  step,
  maxStep,
  title,
  subtitle,
}: {
  step: number;
  maxStep: number;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-6">
      <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
        Step {step} of {maxStep}
      </p>
      <h3 className="mt-1 font-display text-headline-sm font-semibold text-on-surface">
        {title}
      </h3>
      <p className="mt-1 font-body text-body-md text-on-surface-variant">{subtitle}</p>
    </header>
  );
}
