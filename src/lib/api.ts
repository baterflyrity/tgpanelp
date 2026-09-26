import { useCallback, useEffect, useRef, useState } from "react";

export interface ServiceInfo {
  id: string;
  title: string;
  emoji: string;
  description?: string;
  path: string;
}

export interface ServiceStatus {
  id: string;
  path: string;
  status: "online" | "offline" | "stub";
  latencyMs: number | null;
  checkedAt: number;
}

export interface UserInfo {
  id: number;
  firstName: string;
  username?: string;
  photoUrl?: string;
}

interface AuthState {
  status: "loading" | "ready" | "error";
  token: string | null;
  user: UserInfo | null;
  error: string | null;
}

/**
 * Auth flow:
 *  1. Grab Telegram initData (or a dev id when testing mode is on).
 *  2. POST to /api/auth -> { token, user }.
 *  3. Keep token in memory + sessionStorage so reloads re-auth fast.
 */
export function useAuth(): AuthState & { retry: () => void } {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    token: null,
    user: null,
    error: null,
  });

  const authenticate = useCallback(async (initData: string, devUserId?: number) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(devUserId ? { devUserId } : { initData }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const map: Record<string, string> = {
        invalid_init_data: "Telegram signature check failed.",
        not_allowed: "You are not on the allow-list for this bot.",
        dev_auth_disabled: "Testing mode is off on this server. Open the app inside Telegram (or enable DEV_AUTH=1).",
        server_not_configured: "Server is missing its BOT_TOKEN configuration.",
      };
      throw new Error(map[body.error ?? ""] ?? `Auth failed (${res.status})`);
    }
    const data = (await res.json()) as { token: string; user: UserInfo };
    sessionStorage.setItem("token", data.token);
    setState({ status: "ready", token: data.token, user: data.user, error: null });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const wa = window.Telegram?.WebApp;
        const initData = wa?.initData ?? "";

        if (initData) {
          await authenticate(initData);
        } else {
          // No Telegram context: try testing mode. The server decides whether
          // it is enabled (config/app.dev.json) — the client never guesses.
          const devId = Number(new URLSearchParams(location.search).get("devUserId") ?? 1);
          await authenticate("", devId);
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            token: null,
            user: null,
            error: (err as Error).message,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticate]);

  const retry = useCallback(() => {
    sessionStorage.removeItem("token");
    window.location.reload();
  }, []);

  return { ...state, retry };
}

/** Fetch the service list for the current session. */
export function useServices(token: string | null) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/services", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          sessionStorage.removeItem("token");
          window.location.reload();
          return;
        }
        const data = (await res.json()) as { services: ServiceInfo[] };
        if (!cancelled) setServices(data.services ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { services, loading };
}

/**
 * Poll upstream statuses every 15s (server caches probes for the same TTL).
 */
export function useServiceStatus(token: string | null) {
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/status", {
          headers: { Authorization: `Bearer ${tokenRef.current ?? ""}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { services: ServiceStatus[] };
        if (!cancelled) {
          const byPath: Record<string, ServiceStatus> = {};
          for (const s of data.services ?? []) byPath[s.path] = s;
          setStatuses(byPath);
        }
      } catch {
        // transient network error — keep last known statuses
      }
    };

    poll();
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  return statuses;
}

/**
 * Build the proxied URL for a service. The token rides in the query string on
 * the first load; the server validates it, injects it as a first-party cookie
 * (so later in-iframe navigations keep working) and strips it before the
 * request reaches the upstream app.
 */
export function serviceUrl(token: string, svcPath: string): string {
  return `/svc/${svcPath}/?__t=${encodeURIComponent(token)}`;
}
