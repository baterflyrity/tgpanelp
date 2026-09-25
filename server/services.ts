import fs from "node:fs";
import path from "node:path";

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
  const file = path.resolve("services.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list: unknown[] = Array.isArray(parsed) ? parsed : (parsed.services ?? []);
    return list
      .map((s) => s as ServiceConfig)
      .filter((s) => s && s.id && s.target && s.path)
      .map((s) => ({
        ...s,
        target: s.target.replace(/\/+$/, ""),
        path: s.path.replace(/^\/+|\/+$/g, ""),
      }));
  } catch (err) {
    console.warn(`[services] could not load ${file}:`, (err as Error).message);
    return [];
  }
}
