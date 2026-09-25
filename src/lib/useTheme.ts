import { useEffect, useState } from "react";

export function useTheme() {
  const [scheme, setScheme] = useState<"light" | "dark">(
    () => (window.Telegram?.WebApp?.colorScheme as "light" | "dark") || "dark",
  );

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    wa.ready();
    wa.expand();
    wa.setHeaderColor?.("bg_color");
    wa.setBackgroundColor?.("bg_color");

    const handler = () => setScheme(wa.colorScheme);
    wa.onEvent("themeChanged", handler);
    handler();
    return () => wa.offEvent?.("themeChanged", handler);
  }, []);

  return { scheme };
}
