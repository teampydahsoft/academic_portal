"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const DISMISS_KEY = "ap.pwa.install.dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaInstallContextValue = {
  /** Chromium deferred install event is available. */
  canInstall: boolean;
  /** Already running as installed PWA. */
  isInstalled: boolean;
  /** iOS Safari — show Add to Home Screen tips. */
  isIosManual: boolean;
  /** User dismissed the prompt this browser. */
  dismissed: boolean;
  /** Show install UI (installable or iOS tips, not installed, not dismissed). */
  shouldPrompt: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  dismiss: () => void;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const ios =
    "standalone" in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq || ios;
}

function detectIos(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIosManual, setIsIosManual] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* ignore */
    }

    setIsInstalled(detectStandalone());
    setIsIosManual(detectIos() && !detectStandalone());

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failure is non-fatal */
      });
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const mq = window.matchMedia("(display-mode: standalone)");
    const onDisplayMode = () => setIsInstalled(detectStandalone());
    mq.addEventListener?.("change", onDisplayMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onDisplayMode);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      if (outcome === "accepted") setIsInstalled(true);
      return outcome;
    } catch {
      return "unavailable" as const;
    }
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const canInstall = Boolean(deferred);
  const shouldPrompt =
    !isInstalled && !dismissed && (canInstall || isIosManual);

  const value = useMemo(
    () => ({
      canInstall,
      isInstalled,
      isIosManual,
      dismissed,
      shouldPrompt,
      promptInstall,
      dismiss,
    }),
    [
      canInstall,
      isInstalled,
      isIosManual,
      dismissed,
      shouldPrompt,
      promptInstall,
      dismiss,
    ],
  );

  return (
    <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>
  );
}

export function usePwaInstall(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    return {
      canInstall: false,
      isInstalled: false,
      isIosManual: false,
      dismissed: true,
      shouldPrompt: false,
      promptInstall: async () => "unavailable",
      dismiss: () => undefined,
    };
  }
  return ctx;
}
