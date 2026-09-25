import { useCallback, useEffect, useState } from "react";

/**
 * Minimal history-based navigation between the dashboard and a proxied
 * service view, so Telegram's back button can walk the user back out.
 */
export function useMiniRouter() {
  const [view, setView] = useState<string | null>(null); // null = dashboard

  const open = useCallback((svcPath: string) => {
    window.history.pushState({ view: svcPath }, "", `#${svcPath}`);
    setView(svcPath);
  }, []);

  const close = useCallback(() => {
    setView(null);
  }, []);

  useEffect(() => {
    const onPop = () => {
      setView(window.location.hash ? window.location.hash.slice(1) : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { view, open, close, setView };
}
