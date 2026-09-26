import type { ServiceConfig } from "./services.js";

/**
 * Upstream status for the dashboard: online/offline + latency, cached with a
 * TTL so the endpoint can be polled without hammering the upstreams.
 */

export interface UpstreamStatus {
  id: string;
  path: string;
  status: "online" | "offline" | "stub";
  latencyMs: number | null;
  checkedAt: number;
}

const TTL_MS = 15_000;
const cache = new Map<string, { value: UpstreamStatus; at: number }>();

export async function probeUpstream(svc: ServiceConfig): Promise<UpstreamStatus> {
  const now = Date.now();
  const hit = cache.get(svc.path);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const started = Date.now();
  let value: UpstreamStatus;
  try {
    const res = await fetch(svc.target, { signal: AbortSignal.timeout(1500) });
    value = {
      id: svc.id,
      path: svc.path,
      status: "online",
      latencyMs: Date.now() - started,
      checkedAt: now,
    };
  } catch {
    value = {
      id: svc.id,
      path: svc.path,
      status: "offline",
      latencyMs: null,
      checkedAt: now,
    };
  }
  cache.set(svc.path, { value, at: now });
  return value;
}

export function clearStatusCache(): void {
  cache.clear();
}
