#!/usr/bin/env node
/**
 * One-command verification of the whole flow:
 *   health → dev auth → service list → proxied content per service
 *
 * Usage:
 *   bun run check                       # against http://localhost:3000
 *   bun run check https://your.host     # against any deployment
 *   bun run check <url> <devUserId>     # custom dev user id
 *
 * In testing mode (config/app.dev.json) this exercises the built-in stubs;
 * against a real deployment it verifies the real upstreams through the
 * proxy. Exits non-zero on the first failure.
 */

const base = (process.argv[2] ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
const devUserId = Number(process.argv[3] ?? 1);

let failed = false;
function step(name, ok, detail = "") {
  const mark = ok ? "✅" : "❌";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function main() {
  console.log(`Checking ${base} as devUserId=${devUserId}\n`);

  // 1) Health
  let health = null;
  try {
    const res = await fetch(`${base}/api/health`);
    health = await res.json();
  } catch (err) {
    step("health", false, `unreachable: ${err.message}`);
    process.exit(1);
  }
  step(
    "health",
    health?.ok === true,
    `testingMode=${health?.testingMode} stubUpstreams=${health?.stubUpstreams} services=${health?.services}`,
  );

  // 2) Auth (devUserId path — testing mode) or expect graceful 403 in prod
  const authRes = await fetch(`${base}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devUserId }),
  });
  let auth = null;
  try { auth = await authRes.json(); } catch { /* non-JSON */ }

  if (authRes.ok && auth?.token) {
    step("auth (testing mode)", true, `user ${auth.user?.firstName ?? "?"} id=${auth.user?.id}`);
  } else if (authRes.status === 403 && auth?.error === "dev_auth_disabled") {
    step("auth (production mode — correctly refuses dev login)", true);
    console.log("\nProduction-mode checks need real Telegram initData — open the app in Telegram instead.");
    process.exit(failed ? 1 : 0);
  } else {
    step("auth", false, `status=${authRes.status} body=${JSON.stringify(auth)}`);
    process.exit(1);
  }

  const token = auth.token;

  // 3) Service list
  const listRes = await fetch(`${base}/api/services`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await listRes.json().catch(() => null);
  const services = list?.services ?? [];
  step(
    "service list",
    listRes.ok && Array.isArray(services),
    services.map((s) => `${s.emoji} ${s.title} (/svc/${s.path})`).join(", ") || "none",
  );
  if (!listRes.ok) process.exit(1);

  // 4) Proxied content per service (via ?__t= → cookie exchange)
  for (const svc of services) {
    const res = await fetch(`${base}/svc/${svc.path}/?__t=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const location = res.headers.get("location") ?? "";
    const cookieOk = setCookie.includes("__svc_") && setCookie.includes("HttpOnly");
    const prefixOk = !location || location.startsWith(`/svc/${svc.path}`);
    step(
      `proxy /svc/${svc.path}`,
      res.status < 400 && cookieOk && prefixOk,
      `status=${res.status}${location ? ` loc=${location}` : ""}${cookieOk ? " cookie=ok" : ""}`,
    );

    // 5) Follow with the exchanged cookie and confirm real content arrives
    const cookie = setCookie.split(";")[0];
    const res2 = await fetch(`${base}${location || `/svc/${svc.path}/`}`, {
      headers: { Cookie: cookie },
    });
    const body = await res2.text();
    const proxied = res2.headers.get("x-proxied-by") === "tg-mini-proxy";
    step(
      `content /svc/${svc.path}`,
      res2.ok && proxied && body.length > 0,
      `${res2.status}, ${body.length} bytes${proxied ? ", via proxy" : ""}`,
    );
  }

  console.log(failed ? "\nFAILED" : "\nAll good — the full flow works.");
  process.exit(failed ? 1 : 0);
}

main();
