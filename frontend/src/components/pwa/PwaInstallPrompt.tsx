"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { getPortalBranding } from "@/lib/portal-branding";
import { usePwaInstall } from "@/components/pwa/PwaInstallProvider";
import { cn } from "@/lib/cn";

type Props = {
  className?: string;
};

/**
 * Floating install banner for the login page (SAMS-style top chip).
 * Login-only — not shown after sign-in.
 */
export function PwaInstallPrompt({ className }: Props) {
  const { shouldPrompt, canInstall, isIosManual, promptInstall, dismiss } =
    usePwaInstall();
  const branding = getPortalBranding();
  const [ready, setReady] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  // Client-only: installability / iOS / dismiss flags resolve after mount.
  if (!ready || !shouldPrompt) return null;

  async function onInstall() {
    if (canInstall) {
      await promptInstall();
      return;
    }
    if (isIosManual) setIosHint(true);
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 sm:top-4 sm:px-4",
        className,
      )}
    >
      <div
        className="pointer-events-auto flex w-full max-w-[520px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_10px_40px_rgba(15,28,46,0.14)] sm:gap-3.5 sm:px-4 sm:py-3"
        role="dialog"
        aria-label="Install Academic Portal"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.appIconMark}
          alt=""
          className="h-10 w-10 shrink-0 rounded-lg object-contain ring-1 ring-slate-100 sm:h-11 sm:w-11"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-700">
            Install Academic Portal
          </p>
          <p className="truncate text-xs text-slate-500">
            Add to home screen for quick access
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onInstall()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-800 sm:px-3.5 sm:text-sm"
        >
          <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {iosHint ? (
        <p className="pointer-events-auto max-w-[520px] rounded-xl bg-white/95 px-3 py-2 text-center text-xs text-slate-600 shadow-md ring-1 ring-slate-200/80">
          In Safari, tap <span className="font-semibold text-navy-900">Share</span>, then{" "}
          <span className="font-semibold text-navy-900">Add to Home Screen</span>.
        </p>
      ) : null}
    </div>
  );
}
