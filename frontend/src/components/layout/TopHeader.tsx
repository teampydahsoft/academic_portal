"use client";

import { Bell, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { breadcrumbsForPath } from "@/lib/navigation";

type Props = {
  onMenuClick: () => void;
};

export function TopHeader({ onMenuClick }: Props) {
  const pathname = usePathname();
  const breadcrumbs = breadcrumbsForPath(pathname);

  return (
    <header className="z-20 shrink-0 border-b border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-sidebar p-2 text-sidebar-foreground hover:bg-sidebar-active lg:hidden"
            onClick={onMenuClick}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <p className="truncate text-sm text-slate-500">
            <Link href="/dashboard" className="hover:text-slate-700">
              Academic Portal
            </Link>
            {breadcrumbs.map((segment, index) => (
              <span key={`${segment.label}-${index}`}>
                <span className="text-slate-300"> / </span>
                {segment.href ? (
                  <Link href={segment.href} className="font-medium text-slate-700 hover:text-navy-900">
                    {segment.label}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-700">{segment.label}</span>
                )}
              </span>
            ))}
          </p>
        </div>

        <Link
          href="/alerts"
          aria-label="Alerts"
          className="relative rounded-md border border-border p-2 text-slate-600 hover:bg-slate-50"
          title="Alerts"
        >
          <Bell className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
