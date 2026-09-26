import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { validateInitData } from "../server/telegram";
import { probeUpstream, clearStatusCache } from "../server/status";
import type { ServiceConfig } from "../server/services";

// ── Telegram initData validation ───────────────────────────────────────────

const BOT_TOKEN = "7000000001:TESTTOKEN";

function makeInitData(user: object, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAF-test",
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("validateInitData", () => {
  const user = { id: 42, first_name: "Jane" };

  it("accepts correctly signed fresh initData", () => {
    const parsed = validateInitData(makeInitData(user), BOT_TOKEN);
    expect(parsed).not.toBeNull();
    expect(parsed!.user.id).toBe(42);
    expect(parsed!.user.first_name).toBe("Jane");
  });

  it("rejects a tampered user payload", () => {
    const data = makeInitData(user);
    const tampered = data.replace("Jane", "Eve");
    expect(validateInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it("rejects a wrong bot token", () => {
    expect(validateInitData(makeInitData(user), "wrong-token")).toBeNull();
  });

  it("rejects stale auth_date", () => {
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    expect(validateInitData(makeInitData(user, old), BOT_TOKEN)).toBeNull();
  });

  it("rejects missing hash", () => {
    expect(validateInitData("user=%7B%7D", BOT_TOKEN)).toBeNull();
  });

  it("rejects malformed user json", () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: "not-json",
    });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    params.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
    expect(validateInitData(params.toString(), BOT_TOKEN)).toBeNull();
  });
});

// ── Upstream status probing ────────────────────────────────────────────────

function svc(port: number, path = "test"): ServiceConfig {
  return { id: path, title: "Test", emoji: "x", target: `http://127.0.0.1:${port}`, path };
}

describe("probeUpstream", () => {
  it("reports online with latency for a listening upstream", async () => {
    const http = await import("node:http");
    const server = http.createServer((_q, r) => r.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    clearStatusCache();
    const status = await probeUpstream(svc(port));
    expect(status.status).toBe("online");
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    server.close();
  });

  it("reports offline when nothing listens", async () => {
    clearStatusCache();
    const status = await probeUpstream(svc(1)); // port 1: nothing there
    expect(status.status).toBe("offline");
    expect(status.latencyMs).toBeNull();
  });

  it("caches results within the TTL", async () => {
    clearStatusCache();
    const first = await probeUpstream(svc(1));
    const second = await probeUpstream(svc(1));
    expect(second.checkedAt).toBe(first.checkedAt);
  });
});
