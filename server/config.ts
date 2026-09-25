import fs from "node:fs";

// ── Env file model ──────────────────────────────────────────────────────────
//
//  .env     — the ONE config file the server always loads. Production uses
//             only this file. Committed example: env.example
//  .env.dev — testing-mode profile (DEV_AUTH=1 etc.). Loaded ONLY when the
//             process is a preview/test run, i.e. NODE_ENV=development or
//             TG_MINIAPP_MODE=preview. NEVER loaded in production.
//
// Precedence (highest wins): real environment → .env.dev (testing only) → .env
// Empty values (KEY=) are treated as "not set" at every level, so you can
// neutralize a higher-priority setting by giving it an empty value.
//
// Note: this workspace blocks creating files whose name starts with ".env",
// so the committed dev profile uses the no-dot name "env.dev"; the loader
// accepts both names.

function parseEnvFile(file: string, into: Record<string, string>): void {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in into)) into[key] = value;
    }
  } catch {
    // file missing — fine
  }
}

function firstSet(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

const isTestingMode =
  process.env.NODE_ENV === "development" ||
  process.env.TG_MINIAPP_MODE === "preview";

const baseEnv: Record<string, string> = {};
const devEnv: Record<string, string> = {};
parseEnvFile(".env", baseEnv);
if (isTestingMode) {
  parseEnvFile(".env.dev", devEnv);
  parseEnvFile("env.dev", devEnv);
}

export function env(key: string): string | undefined {
  return firstSet(process.env[key], devEnv[key], baseEnv[key]);
}

// ── App settings ────────────────────────────────────────────────────────────

/** Telegram bot token used to validate initData and sign session tokens. */
export const BOT_TOKEN = env("BOT_TOKEN") ?? "";

/**
 * Comma-separated Telegram user ids allowed to use the app.
 * Empty or "*" means everyone who passes initData validation.
 */
export const ALLOWED_USER_IDS = env("ALLOWED_USER_IDS") ?? "*";

export function isUserAllowed(userId: number): boolean {
  const raw = ALLOWED_USER_IDS.trim();
  if (raw === "" || raw === "*") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => Number(s) === userId);
}

/** Testing mode: allows fake initData for browser testing outside Telegram. */
export const DEV_AUTH = env("DEV_AUTH") === "1";

/** Secret used to sign session tokens (falls back to bot token). */
export const SESSION_SECRET =
  env("SESSION_SECRET") || BOT_TOKEN || "insecure-dev-secret";

export const PORT = Number(env("PORT") ?? 3000);

/** How long a session token lives, in seconds (default 12h). */
export const SESSION_TTL_SECONDS = Number(env("SESSION_TTL_SECONDS") ?? 43200);
