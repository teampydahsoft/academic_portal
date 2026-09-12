"use client";

import React from "react";
import { cn } from "@/lib/cn";

export type LoadingAnimationProps = {
  /** Optional text label displayed underneath the dots */
  label?: string;
  /** Size variant for the animation dots */
  size?: "sm" | "md" | "lg";
  /** Custom dot color override (defaults to reference purple/violet tone #7C3AED) */
  color?: string;
  /** Optional container class name for styling/layout */
  className?: string;
  /** Whether to apply default centered container padding */
  center?: boolean;
};

export function LoadingAnimation({
  label,
  size = "md",
  color,
  className,
  center = true,
}: LoadingAnimationProps) {
  // Dot dimensions & gap spacing
  const sizeStyles = {
    sm: { dot: "h-2 w-2", gap: "gap-1.5" },
    md: { dot: "h-3 w-3", gap: "gap-2.5" },
    lg: { dot: "h-4 w-4", gap: "gap-3" },
  }[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center transition-opacity duration-300",
        center && "py-10 min-h-[140px] w-full",
        className,
      )}
      role="status"
      aria-label={label || "Loading…"}
    >
      <div className={cn("flex items-center justify-center", sizeStyles.gap)}>
        <span
          className={cn(
            "rounded-full inline-block animate-dot-bounce",
            sizeStyles.dot,
            !color && "bg-violet-600 shadow-xs shadow-violet-500/30",
          )}
          style={{
            backgroundColor: color,
            animationDelay: "0s",
          }}
        />
        <span
          className={cn(
            "rounded-full inline-block animate-dot-bounce",
            sizeStyles.dot,
            !color && "bg-violet-600 shadow-xs shadow-violet-500/30",
          )}
          style={{
            backgroundColor: color,
            animationDelay: "0.18s",
          }}
        />
        <span
          className={cn(
            "rounded-full inline-block animate-dot-bounce",
            sizeStyles.dot,
            !color && "bg-violet-600 shadow-xs shadow-violet-500/30",
          )}
          style={{
            backgroundColor: color,
            animationDelay: "0.36s",
          }}
        />
      </div>

      {label ? (
        <p className="mt-3 text-xs font-medium text-slate-500 tracking-wide animate-pulse">
          {label}
        </p>
      ) : null}
    </div>
  );
}
