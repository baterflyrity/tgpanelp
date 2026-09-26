import { useEffect, useState } from "react";
import { Loading, ErrorState } from "./components/States";
import {
  useAuth,
  useServices,
  useServiceStatus,
  serviceUrl,
  type ServiceInfo,
  type ServiceStatus,
} from "./lib/api";
import { getWebApp, hapticTap } from "./lib/telegram";
import { useTheme } from "./lib/useTheme";
import { useMiniRouter } from "./lib/useMiniRouter";

const STATUS_META: Record<
  ServiceStatus["status"],
  { label: string; dot: string; text: string }
> = {
  online: { label: "online", dot: "bg-emerald-400", text: "text-emerald-400" },
  offline: { label: "offline", dot: "bg-red-400", text: "text-red-400" },
  stub: { label: "stub", dot: "bg-amber-400", text: "text-amber-400" },
};

function ServiceCard({
  svc,
  status,
  onOpen,
}: {
  svc: ServiceInfo;
  status?: ServiceStatus;
  onOpen: () => void;
}) {
  const meta = status ? STATUS_META[status.status] : null;
  return (
    <button
      onClick={onOpen}
      className="group w-full rounded-2xl bg-tg-secondary-bg p-5 text-left transition active:scale-[0.98]"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-tg-bg text-2xl">
          {svc.emoji || "🗂"}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{svc.title}</h3>
            {meta ? (
              <span
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
                {status?.latencyMs != null ? ` ${status.latencyMs}ms` : ""}
              </span>
            ) : null}
            <span className="ml-auto text-tg-hint transition group-active:text-tg-link">
              →
            </span>
          </div>
          {svc.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-tg-hint">
              {svc.description}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ServiceView({
  svc,
  token,
  onBack,
}: {
  svc: ServiceInfo;
  token: string;
  onBack: () => void;
}) {
  const src = serviceUrl(token, svc.path);

  useEffect(() => {
    const wa = getWebApp();
    wa?.BackButton?.show();
    const handler = () => onBack();
    wa?.BackButton?.onClick(handler);
    return () => {
      wa?.BackButton?.offClick(handler);
      wa?.BackButton?.hide();
    };
  }, [onBack]);

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="safe-area flex items-center gap-3 border-b border-tg-hint/20 bg-tg-secondary-bg px-4 py-3">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-tg-link active:opacity-60"
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="truncate text-sm font-semibold">
          {svc.emoji} {svc.title}
        </h1>
      </header>
      <iframe
        title={svc.title}
        src={src}
        className="w-full flex-1 border-0"
        allow="clipboard-write; clipboard-read; fullscreen"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
      />
    </div>
  );
}

export default function App() {
  const { scheme } = useTheme();
  const auth = useAuth();
  const { services, loading: servicesLoading } = useServices(auth.token);
  const statuses = useServiceStatus(auth.token);
  const { view, open, close } = useMiniRouter();

  const activeService =
    view !== null ? services.find((s) => s.path === view) ?? null : null;

  if (auth.status === "loading" || (auth.status === "ready" && servicesLoading)) {
    return <Loading label="Signing you in…" />;
  }

  if (auth.status === "error") {
    return (
      <ErrorState
        title="Access denied"
        message={auth.error ?? undefined}
        onRetry={auth.retry}
      />
    );
  }

  if (activeService) {
    return (
      <ServiceView
        svc={activeService}
        token={auth.token!}
        onBack={() => {
          hapticTap(getWebApp());
          window.history.back();
        }}
      />
    );
  }

  return (
    <div className="safe-area min-h-[100dvh] bg-tg-bg px-4 pb-8 pt-6" data-theme={scheme}>
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          {auth.user?.photoUrl ? (
            <img
              src={auth.user.photoUrl}
              alt=""
              className="h-11 w-11 rounded-full"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-tg-button text-base font-bold text-tg-button-text">
              {(auth.user?.firstName ?? "U").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              Welcome, {auth.user?.firstName ?? "there"} 👋
            </p>
            <p className="truncate text-xs text-tg-hint">
              {auth.user?.username ? `@${auth.user.username} · ` : ""}
              id {auth.user?.id ?? "unknown"}
            </p>
          </div>
        </div>

        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-tg-hint">
          Your dashboards
        </h2>

        <div className="flex flex-col gap-3">
          {services.map((svc) => (
            <ServiceCard
              key={svc.id}
              svc={svc}
              status={statuses[svc.path]}
              onOpen={() => {
                hapticTap(getWebApp());
                open(svc.path);
              }}
            />
          ))}
        </div>

        {services.length === 0 ? (
          <div className="rounded-2xl bg-tg-secondary-bg p-6 text-center text-sm text-tg-hint">
            No services configured. Add one to services.json on the server.
          </div>
        ) : null}

        <p className="mt-8 text-center text-[11px] text-tg-hint opacity-60">
          Served through your server. Nothing leaves the box.
        </p>
      </div>
    </div>
  );
}
