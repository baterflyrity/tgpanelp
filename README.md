# Telegram Mini App → Local Dashboards Proxy

A Telegram Mini App that validates users via signed initData + allow-list, then
proxies their browsers to internal dashboards running on the same server
(localhost-only services, nothing exposed publicly).

## How it works

```
Telegram client
  └─ Mini App (React, served by Node server)
       └─ initData → POST /api/auth → HMAC-verified, allow-listed → session token
            └─ User picks a service → iframe loads /svc/<name>/?__t=<token>
                 └─ Node server strips __t, verifies it, injects first-party
                    cookie, and reverse-proxies to http://127.0.0.1:<port>
```

- **Validation:** Telegram's official HMAC-SHA256 scheme (`WebAppData` key).
- **Allow-list:** `allowedUserIds` in `config/app.json` (list of Telegram ids, `"*"` = open).
- **Proxy:** `http-proxy-middleware` with cookie rewriting so upstream apps
  that set their own cookies keep working; hop-by-hop headers are stripped.
- **WebSockets:** upgrade requests under `/svc/*` are proxied too.
- **Testing mode:** with `devAuth: true` (as in `config/app.dev.json`), anyone
  can test in a plain browser using `?devUserId=123` — no Telegram needed.
  Testing config is loaded ONLY in testing runs (`NODE_ENV=development` or
  `TG_MINIAPP_MODE=preview`); production reads `config/app.json` exclusively.

## Setup (development)

```bash
bun install
bun run build
TG_MINIAPP_MODE=preview bun run start   # testing config from config/app.dev.json
bun run check                            # verify the whole flow in one command
# dashboard: http://localhost:3000/?devUserId=42
```

Hot reload while hacking: `bun run dev:server` (API) + `bun run dev` (Vite on
:5173, proxies /api).

## Configuration (files, not env)

All app configuration lives in `config/`:

| File | Purpose |
|---|---|
| `config/app.example.json` | **Production template** — copy to `config/app.json` and fill in |
| `config/app.json` | Production app config (created by you; git-ignored) |
| `config/app.dev.json` | **Testing config — use as-is** (no secrets; enables dev logins + stubs) |
| `config/services.json` | Production services → `http://127.0.0.1:<port>` targets |
| `config/services.dev.json` | Compose dev services → compose DNS targets |

Which file is used: in **testing mode** (`NODE_ENV=development` or
`TG_MINIAPP_MODE=preview`, set by the dev compose) the server reads
`app.dev.json` + `services.dev.json`; in **production** it reads `app.json`
+ `services.json` only. Env vars `BOT_TOKEN`/`SESSION_SECRET` still override
the JSON if you prefer secret injection.

The `config/` directory is **mounted into the container**, so the update
workflow is edit-on-host, no rebuild:

```bash
git pull
cp config/app.example.json config/app.json   # first time only, then fill in
nano config/app.json config/services.json    # change anything
docker compose up -d                          # re-applies config
```

## Dev environment

Three ways to run it — pick one:

1. **Sandbox/managed preview** (this workspace): already in testing mode.
   Open the preview URL with `?devUserId=42`.
2. **Local without Docker** — built-in stubs stand in for your dashboards:
   ```bash
   bun install && bun run build
   bun run start                 # testing config via config/app.dev.json*
   bun run check                 # verifies the whole flow in one command
   # dashboard: http://localhost:3000/?devUserId=42
   ```
   *`bun run start` is production-mode by default; for testing mode run
   `TG_MINIAPP_MODE=preview bun run start`.
3. **Docker compose** (proxy + nginx/python stub containers):
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   bun run check http://localhost:3000
   ```

`bun run check [url]` runs the full user flow end-to-end: health → dev
auth → service list → proxied content per service (cookie exchange,
`x-proxied-by` marker, non-empty body) — and exits non-zero on failure.

## Adding a service

Edit `config/services.json` (or `config/services.dev.json` for the dev stack):

## Dev stack with stub services

`docker-compose.dev.yml` runs the proxy plus **dumb stub upstreams** on the
internal compose network — only the app port is published to the host. The
proxy uses `config/services.dev.json` whose targets are compose DNS names:

```bash
docker compose -f docker-compose.dev.yml up --build
# then open http://localhost:3000/?devUserId=1
```

The proxy runs in testing mode inside the stack, so plain-browser logins work
without a bot token.

## Production stack with Caddy (automatic HTTPS)

`docker-compose.yml` puts [Caddy](https://caddyserver.com/) in front of the
proxy. Caddy issues and **renews certificates automatically** (ACME with
Let's Encrypt) — no certbot, no cron. Compose-level settings live in `.env`
next to the compose file (only DOMAIN/ports/email — app config is in
`config/`):

```
DOMAIN=panel.example.com      # DNS A record → this server
ACME_EMAIL=you@example.com    # for Let's Encrypt registration
HTTPS_PORT=443                # public https port (custom ports fine, e.g. 8443)
HTTP_PORT=80                  # needed for the HTTP-01 challenge
```

Then `docker compose up -d --build` and open `https://your.domain[:HTTPS_PORT]`.
Custom HTTPS ports work because DNS records don't include ports; port 80 must
stay reachable for certificate issuance/renewal.

## HTTPS: required for Telegram

Telegram Mini Apps **must be served over HTTPS** — plain `http://` URLs are
rejected by BotFather when you register the web app and will not open in
clients. Common setups:

- **Caddy** in front of this server: automatic Let's Encrypt certs,
  two-line config.
- **nginx + certbot** if you already run nginx.
- **A tunnel** (cloudflared, ngrok) for quick tests — it terminates TLS for
  you and points at the Node server's port.

Plain `http://localhost:3000/?devUserId=1` works only for browser testing,
since no Telegram client is involved.

## Telegram wiring

1. In @BotFather → `/mybots` → your bot → **Bot Settings → Menu Button** →
   set it to your mini app URL (`https://your-domain.tld`).
2. Or send users an inline button: `web_app` type with your URL.
3. The domain must be HTTPS. For local testing use a tunnel (cloudflared,
   ngrok) pointed at your Node server port.

## Production

```bash
bun run build
bun run start        # serves dist/ + API + proxy on one port
```

In production the server reads `config/app.json` + `config/services.json`
only — the `.dev` variants are ignored, and `devAuth` must never be true
there. `config/app.json` is git-ignored; create it from the template:

```bash
cp config/app.example.json config/app.json   # fill in botToken etc.
```

Or with Docker (config mounted, no rebuild on edits):

```bash
nano config/app.json config/services.json
docker compose up -d
```

Notes:

- Sessions are in-memory; if you run multiple replicas, move them to Redis.
- Your Telegram app domain needs a reverse proxy (nginx/Caddy) terminating
  TLS in front of this server.
- Upstream services must be bound to 127.0.0.1 so they stay off the public
  internet; this proxy is the only public entry point.
