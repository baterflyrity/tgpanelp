import type { Request, Response } from "express";
import type { ServiceConfig } from "./services.js";

/**
 * In-process stub responses for TESTING MODE (config.stubUpstreams).
 *
 * When a configured upstream (127.0.0.1/localhost or a compose DNS name that
 * is down) has nothing listening, the proxy answers with a stub page instead
 * of a connection error — so the whole auth → dashboard → proxy flow can be
 * verified with zero setup. No extra ports are opened: the stub shares the
 * main HTTP server, which keeps readiness probes and port mappings clean.
 */

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text y="14" font-size="14">🗂</text></svg>`;

function page(svc: ServiceConfig, path: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${svc.emoji} ${svc.title} (stub)</title>
<style>
  body { font-family: system-ui, sans-serif; background: #10151c; color: #e8edf2;
         display: grid; place-items: center; min-height: 92vh; margin: 0; }
  .card { background: #1b232e; padding: 2rem 3rem; border-radius: 14px;
          text-align: center; max-width: 34rem; }
  code  { background: #0b0f14; padding: 2px 8px; border-radius: 6px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${svc.emoji} ${svc.title} — STUB</h1>
    <p>Nothing is listening on <code>${svc.target}</code>, so this is the
       built-in testing stub, served through the proxy at
       <code>/svc/${svc.path}${path}</code>.</p>
    <p>Start the real dashboard and reload — it will be proxied instead.</p>
    <p><a href="/svc/${svc.path}/probe.json" style="color:#7ab8ff">probe.json</a></p>
  </div>
</body>
</html>`;
}

/** Express handler serving stub content for a service (same process/port). */
export function stubHandler(svc: ServiceConfig) {
  return (req: Request, res: Response): void => {
    // Same pipeline marker as proxied responses, so verification scripts can
    // treat stub and real upstream content uniformly.
    res.setHeader("x-proxied-by", "tg-mini-proxy");
    const url = req.path;
    if (url.startsWith("/favicon")) {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(FAVICON);
      return;
    }
    if (url.endsWith("probe.json") || url === "/json") {
      res.json({ stub: true, service: svc.id, url, ts: Date.now() });
      return;
    }
    res.status(200).type("html").send(page(svc, url));
  };
}

const reachability = new Map<string, boolean>();

/**
 * Is the real upstream up? Checked lazily (first request per service) and
 * cached for the process lifetime — restart the server (or `compose up -d`)
 * after starting your real dashboard.
 */
export async function isUpstreamReachable(svc: ServiceConfig): Promise<boolean> {
  const cached = reachability.get(svc.path);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const res = await fetch(svc.target, {
      signal: AbortSignal.timeout(400),
    });
    ok = true; // any HTTP response (even 500) means something is listening
  } catch {
    ok = false;
  }
  reachability.set(svc.path, ok);
  return ok;
}
