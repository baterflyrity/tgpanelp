import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Boots the real server in testing mode (config/app.dev.json: devAuth +
 * stubs) and exercises the full user flow end to end.
 */

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;

let child: ReturnType<typeof spawn> | null = null;

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not start in time");
}

afterAll(() => {
  child?.kill("SIGTERM");
});

describe("server end-to-end (testing mode)", () => {
  it("boots and serves the full flow: health → auth → services → proxy", async () => {
    child = spawn(
      process.execPath,
      ["--import", "tsx", path.resolve("server/index.ts")],
      {
        env: {
          ...process.env,
          PORT: String(PORT),
          TG_MINIAPP_MODE: "preview",
          NODE_ENV: process.env.NODE_ENV ?? "test",
        },
        stdio: "ignore",
      },
    );
    await waitForServer();

    // 1) health reflects testing mode
    const health = await (await fetch(`${BASE}/api/health`)).json();
    expect(health.ok).toBe(true);
    expect(health.testingMode).toBe(true);
    expect(health.devAuth).toBe(true);
    expect(health.services).toBeGreaterThan(0);

    // 2) dev auth works, allow-list from config applies
    const authRes = await fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ devUserId: 42 }),
    });
    expect(authRes.status).toBe(200);
    const auth = (await authRes.json()) as { token: string; user: { id: number } };
    expect(auth.user.id).toBe(42);

    // 3) service list is auth-gated and populated from config
    const noToken = await fetch(`${BASE}/api/services`);
    expect(noToken.status).toBe(401);
    const listRes = await fetch(`${BASE}/api/services`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const list = (await listRes.json()) as {
      services: { path: string }[];
    };
    expect(list.services.length).toBeGreaterThan(0);

    // 4) status endpoint reports every service
    const statusRes = await fetch(`${BASE}/api/status`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const status = (await statusRes.json()) as {
      services: { path: string; status: string }[];
    };
    expect(status.services).toHaveLength(list.services.length);
    for (const s of status.services) {
      expect(["online", "offline", "stub"]).toContain(s.status);
    }

    // 5) proxied stub content flows through with the cookie exchange
    const first = list.services[0]!;
    const firstRes = await fetch(`${BASE}/svc/${first.path}/?__t=${auth.token}`, {
      redirect: "manual",
    });
    expect(firstRes.status).toBeLessThan(400);
    const setCookie = firstRes.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__svc_");
    expect(setCookie).toContain("HttpOnly");

    const cookie = setCookie.split(";")[0]!;
    const second = await fetch(`${BASE}/svc/${first.path}/probe.json`, {
      headers: { Cookie: cookie },
    });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { stub: boolean; service: string };
    expect(body.stub).toBe(true);
    expect(body.service).toBe(first.path);

    // 6) forged tokens are rejected on the proxied path
    const forged = await fetch(`${BASE}/svc/${first.path}/probe.json`, {
      headers: { Cookie: `__svc_${first.path.replace(/[^a-z0-9]/gi, "_")}_tok=forged.a.b` },
    });
    expect(forged.status).toBe(401);
  }, 30000);
});
