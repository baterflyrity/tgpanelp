# Telegram Mini App → Local Dashboards Proxy

[![CI](https://github.com/baterflyrity/tgpanelp/actions/workflows/ci.yml/badge.svg)](https://github.com/baterflyrity/tgpanelp/actions/workflows/ci.yml)
[![tests](badges/tests.svg)](.github/workflows/ci.yml)
[![coverage](badges/coverage.svg)](.github/workflows/ci.yml)
[**📖 Full documentation**](https://baterflyrity.github.io/tgpanelp/) — architecture, configuration cases, deployment, troubleshooting

A Telegram Mini App that authenticates users with Telegram's signed `initData`
(allow-list enforced server-side) and proxies their browser to internal
dashboards running on the same server — services bound to `127.0.0.1:<port>`
that are otherwise unreachable from the internet.

```
Telegram client → Mini App (validated) → dashboard cards (with live status)
              → "Game Dashboard" → proxied view of 127.0.0.1:15080
```

Each service card shows **online / offline / stub** status with latency,
polled every 15 seconds.

## Quick start (development)

```bash
bun install          # or npm install
bun run build
TG_MINIAPP_MODE=preview bun run start
bun run check        # verifies the whole flow in one command
```

Open `http://localhost:3000/?devUserId=42` — no bot token, no Telegram needed:
testing mode accepts dev logins and serves built-in **stub pages** for any
service whose real upstream isn't running. Prefer containers?

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Usage

### Installation

```bash
bun install          # dev dependencies + runtime deps
bun run build        # builds the SPA into dist/ (served by the Node server)
```

### Configuration

All app configuration lives in `config/` (mounted into compose — edit on the
host, no rebuild):

| File | Purpose |
|---|---|
| `config/app.example.json` | **Production template** — copy to `app.json`, fill in |
| `config/app.dev.json` | Testing config, **works as-is** (no secrets) |
| `config/services.json` | Production services → `http://127.0.0.1:<port>` |
| `config/services.dev.json` | Dev compose services → compose DNS names |

```jsonc
// config/app.json (production) — the essentials
{
  "botToken": "7000000000:AA...",       // from @BotFather
  "allowedUserIds": ["123456789"],      // real Telegram ids, "*" = open
  "sessionSecret": "random-64-chars"
}
```

Production mode reads `app.json` + `services.json` only; testing mode
(`NODE_ENV=development` or `TG_MINIAPP_MODE=preview`) reads the `.dev`
variants. [Full configuration reference](https://baterflyrity.github.io/tgpanelp/#/configuration)
with per-environment cases (local / compose / VPS / managed preview).

### Running

| Environment | Command |
|---|---|
| Local testing (stubs, no Docker) | `TG_MINIAPP_MODE=preview bun run start` |
| Local production build | `bun run start` |
| Dev compose (stub containers) | `docker compose -f docker-compose.dev.yml up --build` |
| Production (Caddy + auto-HTTPS) | `cp config/app.example.json config/app.json && nano config/app.json .env && docker compose up -d --build` |

### Updating

```bash
git pull
nano config/*.json        # optional changes
docker compose up -d      # applies config — no rebuild needed
```

Rebuild only when code changes: `docker compose up -d --build`.

### Testing

```bash
bun run test              # unit + end-to-end smoke (boots the real server)
bun run test:coverage     # + coverage report
bun run check [url]       # verify any deployment: health → auth → proxy flow
bun run typecheck         # tsc --noEmit
```

The smoke suite drives the exact production path (HMAC validation, allow-list,
cookie exchange, forged-token rejection), so green CI ≈ working deployment.
[Testing & CI details](https://baterflyrity.github.io/tgpanelp/#/testing).

## How it works

```
Telegram client
  └─ Mini App SPA ── initData ──▶ POST /api/auth
                                    │  HMAC-SHA256 (WebAppData) + allow-list
                                    ▼
                              session token (body.exp.sig)
  └─ iframe /svc/game/?__t=token ──▶ server verifies, strips __t,
       sets first-party HttpOnly cookie, reverse-proxies
         ▶ http://127.0.0.1:15080 (upstream sees no token)
```

- Official Telegram initData validation, timing-safe; 24h freshness window
- Per-service session cookies → in-iframe navigations & WebSockets just work
- Redirect rewriting (`Location: /json` → `/svc/game/json`), cookie path rewriting
- WebSocket upgrades proxied under `/svc/*`
- Live status endpoint with TTL-cached probes (15s)

Deep dive with mermaid diagrams:
[Architecture](https://baterflyrity.github.io/tgpanelp/#/architecture).

## HTTPS

Telegram requires Mini Apps to be served over **HTTPS** (BotFather rejects
`http://`). The production compose includes Caddy, which issues and
auto-renews Let's Encrypt certificates; custom HTTPS ports work (e.g.
`HTTPS_PORT=8443` → `https://your.domain:8443`), port 80 must stay reachable
for the ACME challenge. [Deployment guide](https://baterflyrity.github.io/tgpanelp/#/deployment).

## Repository layout

```
├── server/        # Express API, proxy, auth, config, stubs, status
├── src/           # Mini App SPA (React, Telegram theme)
├── config/        # ALL runtime configuration (mounted into containers)
├── docs/          # documentation site (docsify → GitHub Pages)
├── scripts/       # check.mjs (verify), badges.mjs (CI badges)
├── tests/         # vitest unit + smoke suites
└── stub/          # static pages for compose dev stubs
```

## License

MIT — see [LICENSE](LICENSE).
