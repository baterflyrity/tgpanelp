import fs from "node:fs";
import path from "node:path";
import { IS_TESTING_MODE } from "./config.js";

export interface ServiceConfig {
  id: string;
  /** Label shown on the dashboard card */
  title: string;
  /** Emoji shown on the dashboard card */
  emoji: string;
  /** Short description shown on the dashboard card */
  description?: string;
  /** Upstream base URL, e.g. http://127.0.0.1:15080 */
  target: string;
  /** Path prefix under /svc/, e.g. "game" → /svc/game/... */
  path: string;
}

export function loadServices(): ServiceConfig[] {
  const file = path.resolve(
    IS_TESTING_MODE ? "config/services.dev.json" : "config/services.json",
  );
  let list: unknown[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      services?: unknown[];
    };
    list = Array.isArray(parsed.services) ? parsed.services : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[services] could not parse ${file}:`, (err as Error).message);
    }
  }
  const seen = new Set<string>();
  return list
    .map((s) => s as ServiceConfig)
    .filter(
      (s) =>
        s && s.id && s.target && s.path &&
        !seen.has(s.path) && seen.add(s.path),
    )
    .map((s) => ({
      ...s,
      target: s.target.replace(/\/+$/, ""),
      path: s.path.replace(/^\/+|\/+$/g, ""),
    }));
}
