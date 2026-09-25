import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  BOT_TOKEN,
  isUserAllowed,
  DEV_AUTH,
  SESSION_SECRET,
  SESSION_TTL_SECONDS,
} from "./config.js";
import { validateInitData, type TelegramUser } from "./telegram.js";

export interface SessionData {
  token: string;
  userId: number;
  firstName: string;
  username?: string;
  photoUrl?: string;
  expiresAt: number;
}

// In-memory session store (cleared on restart). If you run multiple
// replicas, swap this for Redis.
const sessions = new Map<string, SessionData>();

function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function mintToken(userId: number): string {
  const body = crypto.randomBytes(24).toString("base64url");
  const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
  // Token = body.exp.signature (3 dot-separated segments). The user id lives
  // in the session store, not the token, so the payload stays 2 fields.
  const payload = `${body}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): SessionData | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [body, expStr, sig] = parts;
  const payload = `${body}.${expStr}`;
  const expected = sign(payload);
  if (
    expected.length !== sig.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return null;
  return sessions.get(token) ?? null;
}

export function createSession(user: TelegramUser): SessionData {
  const session: SessionData = {
    token: mintToken(user.id),
    userId: user.id,
    firstName: user.first_name ?? "there",
    username: user.username,
    photoUrl: user.photo_url,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  sessions.set(session.token, session);
  return session;
}

export interface AuthedRequest extends Request {
  session?: SessionData;
}

export function requireSession(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const session = verifyToken(token);
  if (!session) {
    res.status(401).json({ error: "session_expired" });
    return;
  }
  req.session = session;
  next();
}

/** POST /api/auth  { initData } → { token, user } or 403 if not allow-listed. */
export async function handleAuth(req: Request, res: Response): Promise<void> {
  const initData = String(req.body?.initData ?? "");

  let user: TelegramUser | null = null;

  if (initData) {
    const validated = validateInitData(initData, BOT_TOKEN);
    user = validated?.user ?? null;
  } else if (DEV_AUTH) {
    // Local testing outside Telegram: send { devUserId: 123 } instead.
    const devId = Number(req.body?.devUserId ?? 1);
    user = {
      id: devId,
      first_name: `DevUser${devId}`,
      username: `dev_${devId}`,
    };
  }

  if (!user) {
    res.status(401).json({ error: "invalid_init_data" });
    return;
  }
  if (!isUserAllowed(user.id)) {
    res.status(403).json({ error: "not_allowed" });
    return;
  }

  const session = createSession(user);
  res.json({
    token: session.token,
    user: {
      id: session.userId,
      firstName: session.firstName,
      username: session.username,
      photoUrl: session.photoUrl,
    },
    expiresAt: session.expiresAt,
  });
}
