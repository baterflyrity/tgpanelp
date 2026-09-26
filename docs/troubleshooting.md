# Troubleshooting

## "Access denied" / 403 `dev_auth_disabled`

The server is in **production mode** and you tried a `?devUserId=` login.
Testing mode requires `NODE_ENV=development` or `TG_MINIAPP_MODE=preview`:

- Locally: `TG_MINIAPP_MODE=preview bun run start`
- Compose dev: `docker compose -f docker-compose.dev.yml up` (sets it for you)
- Inside Telegram: logins go through initData instead — if that fails with
  `invalid_init_data`, `botToken` in `config/app.json` is wrong or missing.

## 403 `not_allowed`

Your Telegram id is not in `allowedUserIds` in `config/app.json`. Get your id
from [@userinfobot](https://t.me/userinfobot), add it, then
`docker compose up -d` (config is mounted; no rebuild).

## 403 `server_not_configured`

Production mode with an empty `botToken`. Create `config/app.json` from
`config/app.example.json`.

## Service card shows **offline** (red)

The upstream is not listening on the configured `target`. On the server host:

```bash
curl -v http://127.0.0.1:15080/     # same URL as config/services.json
```

Inside compose, remember the target must be a **compose DNS name**
(`http://stub-game:80`), not `127.0.0.1` — loopback inside the proxy container
is the container itself. Statuses are cached 15s.

## Service card shows **stub** (amber)

Testing mode + `stubUpstreams: true` + the upstream is down. The stub page is
served through the full auth/proxy path. Start the real dashboard and restart
the proxy (reachability is probed once per service per process).

## Mini App opens blank in Telegram

- The URL must be **HTTPS** with a valid certificate (Caddy handles this; a
  tunnel works for tests).
- Check `https://your.domain/api/health` from the internet.
- BotFather's Menu Button URL must match the deployed domain.

## WebSockets don't connect through the proxy

They are supported on `/svc/:name/*` and token-verified via the service
cookie — make sure the iframe did its first load through
`/svc/<name>/?__t=<token>` (the SPA does this automatically). Direct
socket URLs bypassing `/svc/` are not proxied.

## CI badges are stale or missing

Badges are committed by CI on pushes to `main`/`master` (PR runs skip the
commit). If they are missing: check the *Generate badges* and *Commit badges*
steps, and confirm the workflow has `contents: write` permission (it does by
default in this repo's workflow file).

## Documentation site is 404

Enable **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The `deploy-pages` job publishes `docs/` on pushes to `main`/`master`.

## Preview/managed environments

This repo also runs in the Freebuff sandbox preview (testing mode
preconfigured). There, `freebuff-preview restart` applies config changes; the
sandbox blocks creating dot-prefixed env files, which is why app config lives
in `config/*.json` in the first place.
