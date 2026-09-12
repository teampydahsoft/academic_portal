"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  X,
} from "lucide-react";
import { NAV_GROUPS, filterNavGroups, navLabelForItem } from "@/lib/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth/AuthProvider";
import { isTeachingStaffOnly, isSuperAdminUser } from "@/lib/teaching-scope";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

type Props = {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
};

export function Sidebar({ open, collapsed, onClose, onToggleCollapsed }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, authorization, logout, refresh, hasAnyPermission, hasPermission } =
    useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const teachingStaffOnly = isTeachingStaffOnly(authorization);
  const superAdminUser = isSuperAdminUser(authorization);

  const groups = useMemo(
    () =>
      filterNavGroups(NAV_GROUPS, hasAnyPermission, {
        teachingStaffOnly,
        superAdminUser,
      }),
    [hasAnyPermission, teachingStaffOnly, superAdminUser],
  );

  const isItemActive = (href: string) => {
    const [itemPath, itemQuery] = href.split("?");

    if (itemQuery) {
      if (pathname !== itemPath) return false;
      const itemParams = new URLSearchParams(itemQuery);
      let matched = true;
      itemParams.forEach((val, key) => {
        const currentVal = searchParams.get(key);
        if (currentVal !== val) {
          if (
            pathname === "/reports" &&
            key === "tab" &&
            val === "department-timetables" &&
            !currentVal
          ) {
            return;
          }
          matched = false;
        }
      });
      return matched;
    }

    if (pathname === itemPath) return true;

    if (pathname.startsWith(`${itemPath}/`)) {
      const hasExactOtherMatch = groups.some((g) =>
        g.items.some((i) => i.href.split("?")[0] === pathname),
      );
      return !hasExactOtherMatch;
    }

    return false;
  };

  // Auto-expand group containing the active page on load & navigation
  useEffect(() => {
    const parentGroup = groups.find((g) =>
      g.items.some((item) => isItemActive(item.href)),
    );
    if (parentGroup) {
      setExpandedGroups({
        [parentGroup.title]: true,
      });
    }
  }, [pathname, searchParams, groups]);

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const isOpen = Boolean(prev[title]);
      if (isOpen) {
        return {};
      }
      return { [title]: true };
    });
  };

  const roleLabel = useMemo(() => {
    const roles = authorization?.roles ?? [];
    if (!roles.length) return null;
    return roles.map((r) => r.label).join(" · ");
  }, [authorization?.roles]);

  const canOpenProfile =
    Boolean(user) &&
    (hasPermission("user_management.view") ||
      hasPermission("user_management.manage_users"));

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/30 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden={!open}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 lg:static lg:h-full lg:max-h-none lg:translate-x-0",
          collapsed ? "w-[72px]" : "w-[240px]",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-3",
            collapsed && "justify-center px-2",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/icon-mark.png"
            alt="Pydah Academic Portal"
            className="h-8 w-8 shrink-0 rounded-md object-contain"
          />
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-brand-500">
                Pydah Group
              </p>
              <h1 className="truncate text-sm font-semibold text-white">
                Academic Portal
              </h1>
            </div>
          ) : null}
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-300 hover:bg-sidebar-hover lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="hidden rounded-md p-1.5 text-slate-300 hover:bg-sidebar-hover lg:inline-flex"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          {groups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupActive = group.items.some((item) => isItemActive(item.href));
            const isGroupExpanded = expandedGroups[group.title] ?? isGroupActive;
            const hasMultiple = group.items.length > 1;

            if (collapsed) {
              return (
                <div key={group.title} className="group/collapsed-group relative mb-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    className={cn(
                      "mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-all",
                      isGroupActive
                        ? "bg-sidebar-active text-white shadow-sm"
                        : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                    )}
                    title={group.title}
                  >
                    <GroupIcon className="h-5 w-5" />
                  </button>

                  {/* Flyout menu on hover in collapsed mode */}
                  <div className="pointer-events-none absolute left-full top-0 z-50 ml-2.5 w-56 opacity-0 transition-all duration-150 group-hover/collapsed-group:pointer-events-auto group-hover/collapsed-group:opacity-100">
                    <div className="rounded-xl border border-sidebar-border bg-sidebar p-2 shadow-xl">
                      <div className="mb-1 flex items-center justify-between border-b border-sidebar-border/60 px-2.5 py-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                          {group.title}
                        </p>
                        <span className="rounded-full bg-sidebar-active px-1.5 py-0.2 text-[10px] font-medium text-slate-200">
                          {group.items.length}
                        </span>
                      </div>
                      <ul className="space-y-0.5">
                        {group.items.map((item) => {
                          const active = isItemActive(item.href);
                          const ItemIcon = item.icon;
                          const label = navLabelForItem(item, { superAdminUser });
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={onClose}
                                className={cn(
                                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                                  active
                                    ? "bg-sidebar-active font-semibold text-white"
                                    : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                                )}
                              >
                                <ItemIcon
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    active ? "text-brand-400" : "text-slate-400",
                                  )}
                                />
                                <span className="truncate">{label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={group.title} className="mb-2">
                {hasMultiple ? (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.title)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                        isGroupActive
                          ? "bg-sidebar-hover/80 text-white"
                          : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <GroupIcon
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            isGroupActive ? "text-brand-400" : "text-slate-400",
                          )}
                        />
                        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                          {group.title}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full bg-sidebar-border/80 px-1.5 py-0.2 text-[9px] font-medium text-slate-300">
                          {group.items.length}
                        </span>
                        {isGroupExpanded ? (
                          <ChevronDown className="h-3 w-3 text-slate-300" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-slate-300" />
                        )}
                      </div>
                    </button>

                    {isGroupExpanded ? (
                      <ul className="ml-3.5 mt-1 space-y-0.5 border-l border-sidebar-border/80 pl-2.5">
                        {group.items.map((item) => {
                          const active = isItemActive(item.href);
                          const ItemIcon = item.icon;
                          const label = navLabelForItem(item, { superAdminUser });
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={onClose}
                                className={cn(
                                  "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                                  active
                                    ? "bg-sidebar-active text-white font-semibold shadow-2xs"
                                    : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                                )}
                              >
                                {active ? (
                                  <span className="absolute -left-2.5 top-1/2 -mt-2 h-4 w-1 rounded-r-md bg-brand-400" />
                                ) : null}
                                <ItemIcon
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    active
                                      ? "text-brand-400"
                                      : "text-slate-400 group-hover:text-white",
                                  )}
                                />
                                <span className="truncate">{label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  // Single-item group rendered as top-level link
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = isItemActive(item.href);
                      const ItemIcon = item.icon;
                      const label = navLabelForItem(item, { superAdminUser });
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={onClose}
                            className={cn(
                              "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                              active
                                ? "bg-sidebar-active text-white font-semibold shadow-2xs"
                                : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                            )}
                          >
                            {active ? (
                              <span className="absolute -left-2 top-1/2 -mt-2 h-4 w-1 rounded-r-md bg-brand-400" />
                            ) : null}
                            <ItemIcon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                active
                                  ? "text-brand-400"
                                  : "text-slate-400 group-hover:text-white",
                              )}
                            />
                            <span className="truncate font-medium">{label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-sidebar-border px-2 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            collapsed && "px-1.5",
          )}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={!canOpenProfile}
                onClick={() => {
                  if (!canOpenProfile) return;
                  setProfileOpen(true);
                  onClose();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-sidebar-hover hover:text-white disabled:cursor-default disabled:hover:bg-transparent"
                title={user?.name || "Profile"}
                aria-label="Profile"
              >
                <UserRound className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-sidebar-hover hover:text-white"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={!canOpenProfile}
                onClick={() => {
                  if (!canOpenProfile) return;
                  setProfileOpen(true);
                  onClose();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-sidebar-hover disabled:cursor-default disabled:hover:bg-transparent"
                title={canOpenProfile ? "View / edit your profile" : undefined}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-active text-white">
                  <UserRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-white">
                    {user?.name || "Signed in"}
                  </span>
                  <span className="block truncate text-[11px] text-slate-300">
                    {roleLabel || user?.email || user?.username || "HRMS account"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-slate-300 transition hover:bg-sidebar-hover hover:text-white"
              >
                <LogOut className="h-4 w-4 shrink-0 text-slate-300" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {profileOpen && user && canOpenProfile ? (
        <SelfProfileModal
          userId={user.id}
          onClose={() => setProfileOpen(false)}
          onSaved={async () => {
            await refresh();
            setProfileOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function SelfProfileModal(props: {
  userId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocalBootstrap, setIsLocalBootstrap] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const inputClass =
    "mt-1 h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-600";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/users/${props.userId}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.message || "Failed to load profile");
        if (cancelled) return;
        setName(String(body.name ?? ""));
        setEmail(String(body.email ?? ""));
        setUsername(String(body.username ?? ""));
        setIsLocalBootstrap(Boolean(body.isLocalBootstrap));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.userId]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error("Name is required");
      if (isLocalBootstrap && !username.trim()) throw new Error("Username is required");
      if (newPassword || confirmPassword || currentPassword) {
        if (!isLocalBootstrap) throw new Error("Password is managed in HRMS");
        if (!currentPassword) throw new Error("Enter your current password");
        if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");
        if (newPassword !== confirmPassword) throw new Error("Password confirmation does not match");
      }

      const payload: Record<string, string> = { name: name.trim() };
      if (isLocalBootstrap) {
        payload.email = email.trim();
        payload.username = username.trim();
        if (newPassword) {
          payload.currentPassword = currentPassword;
          payload.newPassword = newPassword;
        }
      }

      const response = await apiFetch(`/users/${props.userId}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to save profile");
      await props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={props.onClose} />
      <div className="relative flex w-full max-w-lg flex-col max-h-[85vh] rounded-xl border border-border bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-semibold text-slate-700">My profile</h3>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </div>
        <div className="overflow-y-auto space-y-3 px-5 py-4">
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {error ? <p className="text-sm text-critical">{error}</p> : null}
          {!loading ? (
            <>
              <label className="block text-xs font-medium text-slate-500">
                Display name
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              {isLocalBootstrap ? (
                <>
                  <label className="block text-xs font-medium text-slate-500">
                    Username
                    <input
                      className={inputClass}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-500">
                    Email
                    <input
                      className={inputClass}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Change password (optional)
                    </p>
                    <label className="block text-xs font-medium text-slate-500">
                      Current password
                      <input
                        type="password"
                        className={inputClass}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-500">
                      New password
                      <input
                        type="password"
                        className={inputClass}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-500">
                      Confirm new password
                      <input
                        type="password"
                        className={inputClass}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Username, email, and password are managed in HRMS for linked accounts.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={props.onClose}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
