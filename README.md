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
- **Allow-list:** `ALLOWED_USER_IDS` env var (comma-separated Telegram ids).
- **Proxy:** `http-proxy-middleware` with cookie rewriting so upstream apps
  that set their own cookies keep working; hop-by-hop headers are stripped.
- **WebSockets:** upgrade requests under `/svc/*` are proxied too.
- **Testing mode:** with `DEV_AUTH=1` (via `.env.dev`), anyone can test in a
  plain browser using `?devUserId=123` — no Telegram needed. `.env.dev` is
  loaded ONLY in testing runs (`NODE_ENV=development` or
  `TG_MINIAPP_MODE=preview`); production loads `.env` exclusively.

## Setup

```bash
bun install

# 1. Create a bot with @BotFather, get the token
# 2. Find your Telegram id via @userinfobot
# 3. Configure env vars (see env.example)

BOT_TOKEN=123:ABC... ALLOWED_USER_IDS=111111111,222222222 DEV_AUTH=1 \
  bun run dev:server   # API on :3000 with hot reload

bun run dev            # Vite on :5173, proxies /api to :3000
```

Open `http://localhost:5173/?devUserId=111111111` — DEV_AUTH must be 1.

## Adding a service

Edit `services.json`:

```json
[
  {
    "id": "game",
    "title": "Game Dashboard",
    "emoji": "🎮",
    "description": "My game's admin panel",
    "target": "http://127.0.0.1:15080",
    "path": "game"
  }
]
```

The service becomes available at `/svc/game/` for authorized users.

## Dev stack with stub services

`docker-compose.dev.yml` runs the proxy plus **dumb stub upstreams** that
publish on host loopback at exactly the ports `services.json` expects
(nginx on `127.0.0.1:15080`, python stdlib server on `127.0.0.1:8123`):

```bash
docker compose -f docker-compose.dev.yml up --build
# then open http://localhost:3000/?devUserId=1
```

The proxy runs in testing mode inside the stack, so plain-browser logins work
without a bot token.

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

In production only `.env` is read — `.env.dev`/`env.dev` are ignored, and
`DEV_AUTH=1` must never be set there.

Or with Docker:

```bash
cp env.example .env   # edit it
docker compose up -d
```

Notes:

- Sessions are in-memory; if you run multiple replicas, move them to Redis.
- Your Telegram app domain needs a reverse proxy (nginx/Caddy) terminating
  TLS in front of this server.
- Upstream services must be bound to 127.0.0.1 so they stay off the public
  internet; this proxy is the only public entry point.
