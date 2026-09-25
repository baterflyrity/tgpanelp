import { useEffect, useState } from "react";

/**
 * Thin wrapper over the Telegram WebApp global injected by
 * https://telegram.org/js/telegram-web-app.js
 */

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: TgUser };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  enableClosingConfirmation?: () => void;
  BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  MainButton?: { hide: () => void };
  HapticFeedback?: { impactOccurred: (s: string) => void };
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  viewportStableHeight?: number;
  onEvent: (e: string, cb: () => void) => void;
  offEvent?: (e: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export function getWebApp(): TgWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function useWebApp(): TgWebApp | null {
  const [wa, setWa] = useState<TgWebApp | null>(null);
  useEffect(() => {
    setWa(getWebApp());
  }, []);
  return wa;
}

/** Firebase-style one-shot haptic tap, safe to call outside Telegram. */
export function hapticTap(wa: TgWebApp | null): void {
  try {
    wa?.HapticFeedback?.impactOccurred("light");
  } catch {
    // not in telegram, ignore
  }
}
