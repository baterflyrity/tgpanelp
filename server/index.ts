import express from "express";
import http from "node:http";
import type { Socket } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { PORT, DEV_AUTH, ALLOWED_USER_IDS, SESSION_TTL_SECONDS } from "./config.js";
import { loadServices, type ServiceConfig } from "./services.js";
import {
  requireSession,
  handleAuth,
  verifyToken,
  type AuthedRequest,
} from "./auth.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const services = loadServices();
const serviceByPath = new Map(services.map((s) => [s.path, s]));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.post("/api/auth", handleAuth);

app.get(
  "/api/services",
  requireSession,
  (req: AuthedRequest, res) => {
    res.json({
      user: {
        id: req.session!.userId,
        firstName: req.session!.firstName,
        username: req.session!.username,
        photoUrl: req.session!.photoUrl,
      },
      services: services.map(({ id, title, emoji, description, path }) => ({
        id,
        title,
        emoji,
        description,
        path,
      })),
    });
  },
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, devAuth: DEV_AUTH });
});

// ---------------------------------------------------------------------------
// Reverse proxy: /svc/<name>/* → upstream target
//
// Token resolution order: ?__t= (first iframe load) → per-service cookie
// (set after the first load) → Authorization: Bearer (API clients).
// ---------------------------------------------------------------------------

interface ProxyRequest extends express.Request {
  svc?: ServiceConfig;
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

// A dedicated cookie name per service path, so a user can have several
// dashboards open at once without them clobbering each other's cookies.
function cookieNameFor(svc: ServiceConfig): string {
  return `__svc_${svc.path.replace(/[^a-z0-9]/gi, "_")}_tok`;
}

// 1) Resolve + verify the session, strip __t from the query.
app.use("/svc", (req: ProxyRequest, res, next) => {
  // NOTE: inside app.use the path is mounted, so match on originalUrl.
  const m = req.originalUrl.match(/^\/svc\/([^/?]+)/);
  const svc = m ? serviceByPath.get(m[1]) : undefined;
  if (!svc) {
    res.status(404).send("Unknown service");
    return;
  }
  req.svc = svc;

  // req.url here is relative to the /svc mount: "<name>/rest?query"
  const qi = req.url.indexOf("?");
  const pathname = qi === -1 ? req.url : req.url.slice(0, qi);
  const params = new URLSearchParams(qi === -1 ? "" : req.url.slice(qi + 1));

  const queryToken = params.get("__t") ?? "";
  if (queryToken) params.delete("__t");

  const cookies = parseCookies(req.headers.cookie ?? "");
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const token = queryToken || cookies[cookieNameFor(svc)] || bearer;

  if (!verifyToken(token)) {
    res.status(401).send("Unauthorized");
    return;
  }

  if (queryToken) {
    // Drop __t so the upstream never sees it; remember to set the cookie
    // on the way back out.
    req.url = pathname + (params.toString() ? `?${params}` : "");
    res.locals.viaQueryToken = token;
  }
  next();
});

// 2) Proxy HTTP. Runs after (1), so req.url is verified and __t-free.
app.use("/svc", (req: ProxyRequest, res, next) => {
  const svc = req.svc!;
  // Strip the service prefix: upstream sees "/json", not "/game/json".
  req.url = req.url.replace(/^\/[^/]*/, "") || "/";

  const viaQueryToken =
    typeof res.locals.viaQueryToken === "string" ? res.locals.viaQueryToken : null;
  const name = cookieNameFor(svc);

  const proxy = createProxyMiddleware({
    target: svc.target,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    cookiePathRewrite: { "*": `/svc/${svc.path}` },
    on: {
      proxyReq: fixRequestBody,
      proxyRes: (proxyRes) => {
        proxyRes.headers["x-proxied-by"] = "tg-mini-proxy";

        // Re-add the /svc/<name> prefix to same-app redirects
        // (Location: /json → /svc/game/json).
        const loc = proxyRes.headers.location;
        if (loc) {
          try {
            const u = new URL(loc, "http://upstream.internal");
            if (
              u.host === "upstream.internal" ||
              u.host === (req.headers.host ?? "")
            ) {
              proxyRes.headers.location = `/svc/${svc.path}${u.pathname}${u.search}`;
            }
          } catch {
            // unparseable Location — leave as-is
          }
        }

        // First load via ?__t=: hand the iframe a first-party cookie so
        // later in-iframe navigations, fetches and sockets authenticate.
        if (viaQueryToken) {
          const existing = proxyRes.headers["set-cookie"] ?? [];
          proxyRes.headers["set-cookie"] = [
            ...existing,
            `${name}=${viaQueryToken}; Path=/svc/${svc.path}/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
          ];
        }
      },
    },
  });
  proxy(req, res, next);
});

// ---------------------------------------------------------------------------
// WebSocket upgrade for proxied services
// ---------------------------------------------------------------------------

const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  const m = url.match(/^\/svc\/([^/?]+)/);
  const svc = m ? serviceByPath.get(m[1]) : undefined;
  if (!svc) {
    socket.destroy();
    return;
  }

  const u = new URL(url, "http://internal");
  const queryToken = u.searchParams.get("__t") ?? "";
  const cookies = parseCookies(req.headers.cookie ?? "");
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const token = queryToken || cookies[cookieNameFor(svc)] || bearer;
  if (!verifyToken(token)) {
    socket.destroy();
    return;
  }

  u.searchParams.delete("__t");
  req.url =
    (u.pathname.replace(/^\/svc\/[^/]+/, "") || "/") +
    (u.searchParams.toString() ? `?${u.searchParams}` : "");

  const upstream = new URL(svc.target);
  const proxy = createProxyMiddleware({
    target: upstream.origin,
    ws: true,
    changeOrigin: true,
  });
  proxy.upgrade?.(req, socket as Socket, head);
});

// ---------------------------------------------------------------------------
// Static frontend (production / single-port deployments)
// ---------------------------------------------------------------------------

const distDir = path.resolve("dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] dev auth: ${DEV_AUTH ? "ON" : "off"}`);
  console.log(
    `[server] allow-list: ${
      ALLOWED_USER_IDS === "*" || ALLOWED_USER_IDS.trim() === ""
        ? "open (any validated telegram user)"
        : ALLOWED_USER_IDS
    }`,
  );
  if (services.length === 0) {
    console.warn("[server] no services configured in services.json");
  } else {
    for (const s of services) {
      console.log(`[server]   /svc/${s.path} → ${s.target}`);
    }
  }
});
