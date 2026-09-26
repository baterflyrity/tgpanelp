# Architecture

## Component overview

```mermaid
flowchart TB
    subgraph CLIENT["Telegram client / browser"]
        UI["Mini App SPA (React)<br/>src/App.tsx"]
    end

    subgraph SERVER["Node server (single process, one port)"]
        AUTH["/api/auth<br/>HMAC validation + allow-list"]
        LIST["/api/services"]
        STATUS["/api/status<br/>15s-cached probes"]
        HEALTH["/api/health"]
        PROXY["Reverse proxy /svc/:name/*<br/>http-proxy-middleware"]
        WS["WebSocket upgrade handler"]
        STUBS["Stub handlers<br/>(testing mode only)"]
        STATIC["Static dist/ + SPA fallback"]
        CFG["config loader<br/>config/*.json"]
    end

    subgraph UPSTREAM["Host loopback / compose network"]
        S1[Dashboard A]
        S2[Dashboard B]
    end

    UI -->|initData| AUTH
    UI -->|Bearer token| LIST
    UI -->|Bearer token| STATUS
    UI -->|iframe /svc/name/?__t=token| PROXY
    PROXY --> S1
    PROXY --> S2
    PROXY -.dead upstream in testing.-> STUBS
    WS --> S1
    CFG --> AUTH
    CFG --> PROXY
```

## Authentication flow

```mermaid
sequenceDiagram
    autonumber
    participant T as Telegram client
    participant SPA as Mini App SPA
    participant API as Node server
    participant UP as Upstream dashboard

    T->>SPA: opens Mini App (initData signed by Telegram)
    SPA->>API: POST /api/auth {initData}
    API->>API: HMAC-SHA256(data-check-string, WebAppData secret)
    API->>API: auth_date freshness (≤24h) + allow-list check
    API-->>SPA: {token (body.exp.sig), user}
    SPA->>API: GET /api/services (Bearer token)
    API-->>SPA: service cards + user info
    SPA->>SPA: renders dashboard, polls /api/status every 15s
    SPA->>API: iframe GET /svc/game/?__t=token
    API->>API: verify token, strip __t
    API->>UP: GET / (cookie __svc_game_tok set on response)
    UP-->>API: dashboard HTML
    API-->>SPA: HTML + Set-Cookie (first-party, HttpOnly)
    Note over SPA,UP: later navigations/fetches/sockets<br/>authenticate via the cookie
```

### Session tokens

- Format: `body.expiry.signature` — HMAC-SHA256 signed, timing-safe compare.
- The user id lives **in the server-side session store**, not in the token.
- Store is in-memory: restart logs everyone out; move to Redis for replicas.

### initData validation (server/telegram.ts)

Exactly Telegram's documented scheme:

1. `data-check-string` = sorted `key=value` lines of initData minus `hash`.
2. `secret = HMAC-SHA256(key="WebAppData", msg=botToken)`.
3. Valid iff `HMAC-SHA256(key=secret, msg=data-check-string) == hash`
   (timing-safe compare) **and** `auth_date` is within 24h.

## Reverse proxy details

```mermaid
flowchart TD
    REQ["GET /svc/game/json?__t=T"] --> M{"service known?"}
    M -- no --> E404["404 Unknown service"]
    M -- yes --> TOK{"token from __t / cookie / Bearer"}
    TOK -- invalid --> E401["401 Unauthorized"]
    TOK -- valid --> Q["strip __t from query"]
    Q --> STUB{"testing mode + stubs on<br/>+ upstream dead?"}
    STUB -- yes --> SH["stub handler<br/>(sets cookie too)"]
    STUB -- no --> PX["proxy to target<br/>- strip /svc/game prefix<br/>- fixRequestBody<br/>- rewrite Location headers<br/>- rewrite cookie paths"]
    PX --> R["x-proxied-by: tg-mini-proxy"]
    SH --> R
```

- **Cookie exchange:** the first iframe load authenticates via `?__t=`; the
  server removes it before the upstream sees it and sets
  `__svc_<name>_tok` as a first-party, `HttpOnly`, `SameSite=Lax` cookie
  scoped to `/svc/<name>/`. Each service gets its own cookie so several
  dashboards can be open at once.
- **Redirects:** upstream `Location: /json` becomes `/svc/game/json`
  (same-host redirects only; absolute external redirects pass through).
- **WebSockets:** the HTTP `upgrade` event is intercepted for `/svc/:name/*`,
  token-verified, prefix-stripped and proxied with `ws: true`.
- **Status probes:** `/api/status` pings each upstream root with a 1.5s
  timeout, TTL-cached 15s; in testing mode with stubs a dead upstream reports
  `stub` instead of `offline`.

## Configuration loading

```mermaid
flowchart LR
    F1["config/app.json<br/>(production)"] --> M
    F2["config/app.dev.json<br/>(testing only)"] --> M
    E1["env PORT / BOT_TOKEN /<br/>SESSION_SECRET"] -->|override| M["mergeAppConfig()"]
    M --> C["appConfig used by<br/>auth / proxy / stubs / listen"]
    MODE{"testing mode?"} --> F2
```

Testing mode = `NODE_ENV === "development"` or `TG_MINIAPP_MODE === "preview"`.
The Dockerfile sets `NODE_ENV=production`, so a container never accidentally
loads dev config; the dev compose explicitly sets `TG_MINIAPP_MODE=preview`.

## Stub subsystem (testing only)

- `server/stubs.ts` exports an **in-process handler** — it shares the main
  HTTP port and opens no extra listeners (kept deliberate: extra ports break
  container/preview readiness probes).
- A lazy reachability probe (400ms timeout, cached for the process lifetime)
  routes requests to the stub only while the real upstream is down. Start the
  real dashboard and restart the server — or just accept that stubs win after
  a fresh boot until the first probe.

## Repository layout

```
├── server/            # Express + proxy + auth + config + stubs + status
├── src/               # Mini App SPA (React, Telegram theme vars)
├── config/            # ALL runtime configuration (mounted into containers)
├── docs/              # this documentation site (docsify, GitHub Pages)
├── scripts/           # check.mjs (one-command verify), badges.mjs
├── tests/             # vitest unit + end-to-end smoke tests
├── stub/              # static pages for the compose dev stub containers
├── Caddyfile          # TLS terminator config (env-templated)
├── docker-compose.yml # production: Caddy + proxy
└── docker-compose.dev.yml # dev: proxy + stub containers, config mounted
```
