export default function QuotationsLoading() {
  return (
    <div className="space-y-3">
      {[0, 1].map((idx) => (
        <div
          key={idx}
          className="h-28 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
        />
      ))}
    </div>
  );
}
