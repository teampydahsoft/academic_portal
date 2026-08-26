"use client";

import { Bell, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/navigation";

function titleFromPath(pathname: string) {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item.label;
      }
    }
  }
  return "Academic Portal";
}

type Props = {
  onMenuClick: () => void;
};

export function TopHeader({ onMenuClick }: Props) {
  const pathname = usePathname();
  const title = titleFromPath(pathname);

  return (
    <header className="z-20 shrink-0 border-b border-border bg-white">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
            onClick={onMenuClick}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <p className="truncate text-sm text-slate-500">
            Academic Portal <span className="text-slate-300">/</span>{" "}
            <span className="font-medium text-slate-900">{title}</span>
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
