"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

type Props = {
  name: string;
  photo: string | null;
  /** When list omits photo bytes, pass id + hasPhoto to lazy-load. */
  studentId?: string;
  hasPhoto?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClass = {
  sm: "h-9 w-9 text-[11px]",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-sm",
} as const;

function AvatarFallback({
  name,
  size,
  className,
}: {
  name: string;
  size: keyof typeof sizeClass;
  className?: string;
}) {
  return (
    <div
      className={cn(
        sizeClass[size],
        "flex shrink-0 items-center justify-center rounded-full border border-border bg-slate-100 font-semibold text-navy-800",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

export function StudentAvatar({
  name,
  photo,
  studentId,
  hasPhoto = false,
  size = "md",
  className,
}: Props) {
  const [failed, setFailed] = useState(false);
  const [lazyPhoto, setLazyPhoto] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    setLazyPhoto(null);
  }, [studentId, photo]);

  useEffect(() => {
    if (photo || !hasPhoto || !studentId) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await apiFetch(`/students/${studentId}/photo`, {
          cache: "force-cache",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { photo?: string | null };
        if (!cancelled && body.photo) setLazyPhoto(body.photo);
      } catch {
        // keep initials fallback
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [photo, hasPhoto, studentId]);

  const src = photo || lazyPhoto;
  if (!src || failed) {
    return <AvatarFallback name={name} size={size} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- stored as data URIs / external URLs from student DB
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn(
        sizeClass[size],
        "shrink-0 rounded-full border border-border object-cover bg-slate-50",
        className,
      )}
    />
  );
}
