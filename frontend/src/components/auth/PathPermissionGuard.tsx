"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { NAV_GROUPS } from "@/lib/navigation";

function requiredPermissionsForPath(pathname: string): string[] | null {
  let bestMatch: { href: string; permissions: string[] | null } | null = null;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!bestMatch || item.href.length > bestMatch.href.length) {
          bestMatch = { href: item.href, permissions: item.permissions ?? null };
        }
      }
    }
  }

  if (pathname.startsWith("/settings/roles")) {
    return ["roles.view", "roles.manage"];
  }
  if (pathname.startsWith("/settings/request-workflows")) {
    return ["request.workflow.manage"];
  }
  if (pathname.startsWith("/settings")) {
    return ["settings.view"];
  }
  if (pathname.startsWith("/user-management")) {
    return ["user_management.view", "user_management.manage_users"];
  }
  if (pathname.startsWith("/pending-exceptions")) {
    return ["pending_exceptions.view"];
  }
  if (pathname.startsWith("/reports")) {
    return ["reports.view"];
  }
  if (pathname.startsWith("/alerts")) {
    return ["alerts.view"];
  }
  if (pathname.startsWith("/my-timetable")) {
    return ["my_timetable.view"];
  }
  if (pathname.startsWith("/attendance-analytics")) {
    return ["attendance_analytics.view"];
  }

  return bestMatch?.permissions ?? null;
}

/** UX-only page gate. Backend remains the source of truth. */
export function PathPermissionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading, hasAnyPermission } = useAuth();
  const required = useMemo(() => requiredPermissionsForPath(pathname), [pathname]);
  const allowed = !required?.length || hasAnyPermission(...required);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-white p-6 text-sm text-slate-600">
        You do not have permission to view this page. Contact an administrator if you need access.
      </div>
    );
  }

  return <>{children}</>;
}
