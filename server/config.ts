import fs from "node:fs";

function readEnvFileInto(env: Record<string, string>): void {
  // Minimal .env loader so the server works without dotenv in dev.
  try {
    const raw = fs.readFileSync(".env", "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  } catch {
    // no .env file — fine
  }
}

const fileEnv: Record<string, string> = {};
readEnvFileInto(fileEnv);

export function env(key: string): string | undefined {
  return process.env[key] ?? fileEnv[key];
}

/** Telegram bot token used to validate initData and mint session JWTs. */
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

/** MASTER override — allows fake initData for local testing outside Telegram. */
export const DEV_AUTH = env("DEV_AUTH") === "1";

/** Secret used to sign session tokens (falls back to bot token). */
export const SESSION_SECRET =
  env("SESSION_SECRET") || BOT_TOKEN || "insecure-dev-secret";

export const PORT = Number(env("PORT") ?? 3000);

/** How long a session token lives, in seconds (default 12h). */
export const SESSION_TTL_SECONDS = Number(env("SESSION_TTL_SECONDS") ?? 43200);
