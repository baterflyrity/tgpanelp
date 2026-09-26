import fs from "node:fs";
import path from "node:path";

// ── Configuration model ─────────────────────────────────────────────────────
//
// All app configuration lives in JSON files under config/ (mounted into the
// container), NOT in env files. Edit on the server host + `compose up -d`
// re-applies it without a rebuild.
//
//   config/app.json         — production app config (copy from app.example.json)
//   config/app.dev.json     — testing config, used AS-IS (no secrets)
//   config/services.json    — production services (real dashboards)
//   config/services.dev.json— compose dev stub services
//
// Testing mode = NODE_ENV=development or TG_MINIAPP_MODE=preview (set by the
// dev compose / sandbox preview). Precedence: real env vars → app.dev.json
// (testing only) → app.json.

export const IS_TESTING_MODE =
  process.env.NODE_ENV === "development" ||
  process.env.TG_MINIAPP_MODE === "preview";

export interface AppConfig {
  botToken?: string;
  allowedUserIds: string[];
  sessionSecret?: string;
  sessionTtlSeconds: number;
  devAuth: boolean;
  stubUpstreams: boolean;
  port: number;
}

const DEFAULTS: AppConfig = {
  allowedUserIds: ["*"],
  sessionTtlSeconds: 43200,
  devAuth: false,
  stubUpstreams: false,
  port: 3000,
};

function readJsonIfExists(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[config] could not parse ${file}:`, (err as Error).message);
    }
    return null;
  }
}

function pick<T>(...candidates: (T | undefined | null)[]): T | undefined {
  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== "") return c;
  }
  return undefined;
}

const appJson = readJsonIfExists(path.resolve("config/app.json")) ?? {};
const appDevJson = IS_TESTING_MODE
  ? readJsonIfExists(path.resolve("config/app.dev.json")) ?? {}
  : {};

const ENV_ALIASES: Record<string, string> = {
  botToken: "BOT_TOKEN",
  sessionSecret: "SESSION_SECRET",
};

function mergeAppConfig(): AppConfig {
  const merged: AppConfig = { ...DEFAULTS };
  // Layers, lowest → highest: defaults → app.json → app.dev.json → env vars.
  for (const layer of [appJson, appDevJson]) {
    for (const [k, v] of Object.entries(layer)) {
      if (k === "$comment" || v === null || v === "" || v === undefined) continue;
      (merged as unknown as Record<string, unknown>)[k] = v;
    }
  }
  // Env var overrides (BOT_TOKEN, SESSION_SECRET) for secret-injection setups.
  for (const [jsonKey, envKey] of Object.entries(ENV_ALIASES)) {
    const raw = process.env[envKey];
    if (raw) (merged as unknown as Record<string, unknown>)[jsonKey] = raw;
  }
  return merged;
}

export const appConfig: AppConfig = mergeAppConfig();

// ── Resolved values (used across the server) ────────────────────────────────

/** Telegram bot token used to validate initData and sign session tokens. */
export const BOT_TOKEN = appConfig.botToken ?? "";

/**
 * Comma- or list-style Telegram user ids allowed to use the app.
 * ["*"] (or an id "*") means everyone who passes initData validation.
 */
export const ALLOWED_USER_IDS = appConfig.allowedUserIds;

export function isUserAllowed(userId: number): boolean {
  return ALLOWED_USER_IDS.some((raw) => {
    const v = String(raw).trim();
    return v === "*" || v === "" || Number(v) === userId;
  });
}

/** Testing mode: allows fake initData for browser testing outside Telegram. */
export const DEV_AUTH = appConfig.devAuth === true;

/**
 * Testing mode only: serve built-in stub pages for services with nothing
 * real listening, so the proxy flow can be verified with zero setup.
 */
export const STUB_UPSTREAMS = appConfig.stubUpstreams === true;

/** Secret used to sign session tokens (falls back to bot token). */
export const SESSION_SECRET =
  appConfig.sessionSecret || BOT_TOKEN || "insecure-dev-secret";

export const PORT = Number(process.env.PORT ?? appConfig.port ?? 3000);

/** How long a session token lives, in seconds (default 12h). */
export const SESSION_TTL_SECONDS = Number(
  appConfig.sessionTtlSeconds ?? 43200,
);
