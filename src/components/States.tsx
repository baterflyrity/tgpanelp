export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-tg-hint border-t-tg-link" />
      <p className="text-sm text-tg-hint">{label}</p>
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-4xl">🔒</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {message ? <p className="text-sm text-tg-hint">{message}</p> : null}
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 rounded-xl bg-tg-button px-5 py-2.5 text-sm font-semibold text-tg-button-text active:opacity-80"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
