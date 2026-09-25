import crypto from "node:crypto";

/**
 * Validates Telegram Mini App initData (HMAC-SHA256 per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 */
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
}

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): ValidatedInitData | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // data-check-string: sorted key=value pairs joined by \n
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    computed.length !== hash.length ||
    !crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"))
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    return null;
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(params.get("user") ?? "") as TelegramUser;
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;

  return { user, authDate };
}
