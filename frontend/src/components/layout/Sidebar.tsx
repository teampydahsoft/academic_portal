"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  X,
} from "lucide-react";
import { NAV_GROUPS, filterNavGroups } from "@/lib/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth/AuthProvider";
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
  const { user, authorization, logout, refresh, hasAnyPermission, hasPermission } =
    useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  const groups = useMemo(
    () => filterNavGroups(NAV_GROUPS, hasAnyPermission),
    [hasAnyPermission],
  );

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
          "fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh flex-col border-r border-border bg-white text-slate-700 transition-[width,transform] duration-200 lg:static lg:h-full lg:max-h-none lg:translate-x-0",
          collapsed ? "w-[72px]" : "w-[220px]",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border px-3 py-3",
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
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-brand-700">
                Pydah Group
              </p>
              <h1 className="truncate text-sm font-semibold text-slate-900">
                Academic Portal
              </h1>
            </div>
          ) : null}
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:inline-flex"
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
          {groups.map((group) => (
            <div key={group.title} className={cn("mb-3", collapsed && "mb-2")}>
              {!collapsed ? (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.title}
                </p>
              ) : (
                <div className="mx-auto mb-1 h-px w-6 bg-slate-200" />
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        onClick={onClose}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                          collapsed && "justify-center px-2",
                          active
                            ? "bg-brand-50 text-brand-800"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active
                              ? "text-brand-700"
                              : "text-slate-400 group-hover:text-slate-600",
                          )}
                        />
                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                        {!collapsed && active ? (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-600" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-border px-2 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
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
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                title={user?.name || "Profile"}
                aria-label="Profile"
              >
                <UserRound className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-50"
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
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                title={canOpenProfile ? "View / edit your profile" : undefined}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <UserRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-900">
                    {user?.name || "Signed in"}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {roleLabel || user?.email || user?.username || "HRMS account"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <LogOut className="h-4 w-4 shrink-0 text-slate-400" />
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
          <h3 className="font-semibold text-slate-900">My profile</h3>
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
