"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  MobileDataCardHeader,
  MobileDataCardGrid,
  MobileDataCardField,
} from "@/components/ui/MobileDataCard";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import {
  formatLastLogin,
  formatScope,
  isBootstrapSuperAdmin,
  type ApRoleOption,
  type ManagedRole,
  type ManagedUser,
  type RoleAssignment,
} from "@/features/user-management/types";
import { RolesPermissionsPanel } from "@/features/user-management/RolesPermissionsPanel";
import { CreateUserPanel } from "@/features/user-management/CreateUserPanel";
import { UserPermissionsModal } from "@/features/user-management/UserPermissionsModal";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: ManagedUser[]; total: number };

type TabKey = "create" | "users" | "roles";

const selectClass =
  "h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-navy-800";
const inputClass =
  "h-9 w-full min-w-[200px] rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800";

export function UserManagementView() {
  const { hasPermission, user: authUser, refresh } = useAuth();
  const canManage = hasPermission("user_management.manage_users");
  const { masters } = useAcademicContext();
  const [tab, setTab] = useState<TabKey>(canManage ? "create" : "users");

  const [q, setQ] = useState("");
  const [roleKey, setRoleKey] = useState("all");
  const [status, setStatus] = useState("all");
  const [collegeId, setCollegeId] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [roles, setRoles] = useState<ApRoleOption[]>([]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ManagedUser | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeTarget, setScopeTarget] = useState<RoleAssignment | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, active: 0 });

  const colleges = masters?.colleges ?? [];
  const courses = masters?.courses ?? [];
  const branches = useMemo(() => {
    if (!masters?.branches) return [];
    if (collegeId === "all") return masters.branches;
    const cid = Number(collegeId);
    const courseIds = new Set(courses.filter((c) => c.collegeId === cid).map((c) => c.id));
    return masters.branches.filter((b) => courseIds.has(b.courseId));
  }, [masters, collegeId, courses]);

  const loadUsers = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (roleKey !== "all") params.set("roleKey", roleKey);
      if (status !== "all") params.set("status", status);
      if (collegeId !== "all") params.set("collegeId", collegeId);
      if (branchId !== "all") params.set("branchId", branchId);
      params.set("limit", "100");
      const response = await apiFetch(`/users?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message || "Failed to load users");
      }
      setState({
        status: "ready",
        rows: body.data ?? [],
        total: Number(body.total ?? 0),
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load users",
      });
    }
  }, [q, roleKey, status, collegeId, branchId]);

  const loadStats = useCallback(async () => {
    try {
      const [allRes, activeRes] = await Promise.all([
        apiFetch("/users?limit=1&status=all", { cache: "no-store" }),
        apiFetch("/users?limit=1&status=active", { cache: "no-store" }),
      ]);
      const allBody = await allRes.json().catch(() => ({}));
      const activeBody = await activeRes.json().catch(() => ({}));
      if (allRes.ok && activeRes.ok) {
        setStats({
          total: Number(allBody.total ?? 0),
          active: Number(activeBody.total ?? 0),
        });
      }
    } catch {
      /* keep previous stats */
    }
  }, []);

  const loadRoles = useCallback(async () => {
    const response = await apiFetch("/roles?includeInactive=false", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setRoles(
        (body.data ?? []).map((role: ManagedRole) => ({
          id: role.id,
          roleKey: role.roleKey,
          label: role.label,
          description: role.description,
          isGlobalCapable: role.isGlobalCapable,
          isSystemRole: role.isSystemRole,
          isActive: role.isActive,
          permissions: role.permissions,
        })),
      );
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/users/${id}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to load user");
      setDetail(body as ManagedUser);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to load user");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function setStatusForUser(user: ManagedUser, isActive: boolean) {
    if (!canManage) return;
    const label = isActive ? "activate" : "deactivate";
    if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${user.name}?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/users/${user.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || `Failed to ${label}`);
      setDetail(body as ManagedUser);
      await Promise.all([loadUsers(), loadStats()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Failed to ${label}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!canManage || user.isLocalBootstrap) return;
    if (
      !window.confirm(
        `Permanently remove “${user.name}” from Academic Portal?\n\nThis unlinks the portal account only. HRMS is not changed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/users/${user.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to remove user");
      setSelectedId(null);
      setDetail(null);
      await Promise.all([loadUsers(), loadStats()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove user");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(
    user: ManagedUser,
    payload: {
      name: string;
      email?: string;
      username?: string;
      currentPassword?: string;
      newPassword?: string;
    },
  ) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/users/${user.id}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to update profile");
      setDetail(body as ManagedUser);
      await loadUsers();
      if (authUser?.id === user.id) await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to update profile");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<ManagedUser>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div>
          <p className="font-medium text-navy-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.email || row.username}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee ID",
      render: (row) => row.hrmsEmployeeId || (row.isLocalBootstrap ? "—" : "—"),
    },
    {
      key: "hrms",
      header: "HRMS identity",
      render: (row) =>
        row.isLocalBootstrap ? (
          <span className="text-xs text-slate-500">Local bootstrap</span>
        ) : (
          row.username
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge status={row.isActive ? "Active" : "Inactive"} />
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (row) =>
        row.roles.length ? (
          <div className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <span
                key={role.id}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
              >
                {role.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-slate-400">None</span>
        ),
    },
    {
      key: "scope",
      header: "College / Branch",
      render: (row) =>
        row.roles.length ? (
          <div className="space-y-0.5 text-xs text-slate-600">
            {row.roles.slice(0, 2).map((role) => (
              <p key={role.id}>{formatScope(role)}</p>
            ))}
            {row.roles.length > 2 ? <p>+{row.roles.length - 2} more</p> : null}
          </div>
        ) : (
          "—"
        ),
    },
    {
      key: "lastLogin",
      header: "Last login",
      render: (row) => <span className="text-xs text-slate-600">{formatLastLogin(row.lastLoginAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Create and manage users with role-based access. Import staff from the HRMS employees directory, then assign Academic Portal roles and scope here."
        actions={
          <div className="flex gap-2">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
              <p className="text-lg font-semibold text-navy-900">{stats.total}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-center shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Active</p>
              <p className="text-lg font-semibold text-emerald-800">{stats.active}</p>
            </div>
          </div>
        }
      />

      <div className="mb-4 flex gap-2 border-b border-border">
        {canManage ? (
          <button
            type="button"
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === "create"
                ? "border-navy-800 text-navy-900"
                : "border-transparent text-slate-500 hover:text-navy-800"
            }`}
            onClick={() => setTab("create")}
          >
            Create User
          </button>
        ) : null}
        <button
          type="button"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "users"
              ? "border-navy-800 text-navy-900"
              : "border-transparent text-slate-500 hover:text-navy-800"
          }`}
          onClick={() => setTab("users")}
        >
          All Users ({stats.total})
        </button>
        <button
          type="button"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "roles"
              ? "border-navy-800 text-navy-900"
              : "border-transparent text-slate-500 hover:text-navy-800"
          }`}
          onClick={() => setTab("roles")}
        >
          Role Configuration
        </button>
      </div>

      {tab === "create" && canManage ? (
        <CreateUserPanel
          roles={roles}
          colleges={colleges}
          courses={courses}
          branches={masters?.branches ?? []}
          canManage={canManage}
          onCreated={async (user) => {
            await Promise.all([loadUsers(), loadStats()]);
            setTab("users");
            setSelectedId(user.id);
          }}
        />
      ) : null}

      {tab === "roles" ? <RolesPermissionsPanel canManage={canManage} /> : null}

      {tab === "users" ? (
        <>
      <FilterBar>
        <FilterField label="Search">
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, employee id…"
          />
        </FilterField>
        <FilterField label="Role">
          <select className={selectClass} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            <option value="all">All roles</option>
            {roles.map((role) => (
              <option key={role.roleKey} value={role.roleKey}>
                {role.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </FilterField>
        <FilterField label="College">
          <select
            className={selectClass}
            value={collegeId}
            onChange={(e) => {
              setCollegeId(e.target.value);
              setBranchId("all");
            }}
          >
            <option value="all">All colleges</option>
            {colleges.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Branch">
          <select className={selectClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </select>
        </FilterField>
        <Button variant="secondary" onClick={() => void loadUsers()}>
          Refresh
        </Button>
      </FilterBar>

      {state.status === "loading" ? (
        <Card>
          <p className="text-sm text-slate-500">Loading users…</p>
        </Card>
      ) : null}
      {state.status === "error" ? (
        <Card>
          <p className="text-sm text-critical">{state.message}</p>
          <Button className="mt-3" variant="secondary" onClick={() => void loadUsers()}>
            Retry
          </Button>
        </Card>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p className="mb-2 text-xs text-slate-500">{state.total} users</p>
          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(row) => String(row.id)}
            emptyMessage={
              canManage
                ? "No portal users yet. Open Create User and import an HRMS login account."
                : "No Academic Portal users match these filters."
            }
            mobileRender={(row) => (
              <div className="flex flex-col gap-1">
                <MobileDataCardHeader
                  title={row.name}
                  status={<StatusBadge status={row.isActive ? "active" : "inactive"} />}
                  secondary={
                    <div className="flex flex-col gap-0.5">
                      <span>{row.email || "—"}</span>
                      {row.isLocalBootstrap && <span className="text-xs text-brand-600">Local Bootstrap Account</span>}
                    </div>
                  }
                />
                <MobileDataCardGrid>
                  <MobileDataCardField 
                    label="College / Branch" 
                    value={row.roles.length ? row.roles.slice(0, 2).map((r) => formatScope(r)).join(", ") + (row.roles.length > 2 ? ` (+${row.roles.length - 2} more)` : "") : "—"} 
                  />
                  <MobileDataCardField label="Last login" value={formatLastLogin(row.lastLoginAt)} />
                </MobileDataCardGrid>
              </div>
            )}
            onRowClick={(row) => setSelectedId(row.id)}
          />
        </>
      ) : null}
        </>
      ) : null}

      {tab === "users" && selectedId != null ? (
        <UserDetailModal
          loading={detailLoading}
          user={detail}
          error={actionError}
          canManage={canManage}
          isSelf={authUser?.id === selectedId}
          busy={busy}
          onClose={() => {
            setSelectedId(null);
            setActionError(null);
          }}
          onEditRoles={() => {
            if (detail && isBootstrapSuperAdmin(detail)) return;
            setRolesOpen(true);
          }}
          onEditPermissions={() => {
            if (detail && isBootstrapSuperAdmin(detail)) return;
            setPermissionsOpen(true);
          }}
          onEditScope={(assignment) => {
            if (detail && isBootstrapSuperAdmin(detail)) return;
            setScopeTarget(assignment);
            setScopeOpen(true);
          }}
          onActivate={() => detail && void setStatusForUser(detail, true)}
          onDeactivate={() => detail && void setStatusForUser(detail, false)}
          onDelete={() => detail && void deleteUser(detail)}
          onSaveProfile={(payload) => {
            if (!detail) return Promise.reject(new Error("No user"));
            return saveProfile(detail, payload);
          }}
        />
      ) : null}

      {rolesOpen && detail && canManage ? (
        <RolesDialog
          user={detail}
          roles={roles}
          colleges={colleges}
          courses={courses}
          branches={masters?.branches ?? []}
          onClose={() => setRolesOpen(false)}
          onSaved={async (user) => {
            setRolesOpen(false);
            setDetail(user);
            await Promise.all([loadUsers(), loadStats()]);
          }}
        />
      ) : null}

      {scopeOpen && detail && scopeTarget && canManage ? (
        <ScopeDialog
          user={detail}
          assignment={scopeTarget}
          roles={roles}
          colleges={colleges}
          courses={courses}
          branches={masters?.branches ?? []}
          onClose={() => {
            setScopeOpen(false);
            setScopeTarget(null);
          }}
          onSaved={async (user) => {
            setScopeOpen(false);
            setScopeTarget(null);
            setDetail(user);
            await Promise.all([loadUsers(), loadStats()]);
          }}
        />
      ) : null}

      {permissionsOpen && detail && canManage ? (
        <UserPermissionsModal
          user={detail}
          onClose={() => setPermissionsOpen(false)}
          onSaved={async (user) => {
            setPermissionsOpen(false);
            setDetail(user);
            await Promise.all([loadUsers(), loadStats()]);
          }}
        />
      ) : null}
    </div>
  );
}

function UserDetailModal(props: {
  loading: boolean;
  user: ManagedUser | null;
  error: string | null;
  canManage: boolean;
  isSelf: boolean;
  busy: boolean;
  onClose: () => void;
  onEditRoles: () => void;
  onEditPermissions: () => void;
  onEditScope: (assignment: RoleAssignment) => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onSaveProfile: (payload: {
    name: string;
    email?: string;
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<void>;
}) {
  const user = props.user;
  const bootstrapSuperAdmin = user ? isBootstrapSuperAdmin(user) : false;
  const canManageRolesAndScope = props.canManage && !bootstrapSuperAdmin;
  const canEditProfile =
    Boolean(user) && (props.isSelf || props.canManage) && (user?.isLocalBootstrap || props.canManage);
  const canEditIdentity = Boolean(user?.isLocalBootstrap) && (props.isSelf || props.canManage);
  const canChangePassword = Boolean(user?.isLocalBootstrap && props.isSelf);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email ?? "");
    setUsername(user.username);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setEditing(false);
    setLocalError(null);
  }, [user?.id, user?.name, user?.email, user?.username]);

  async function save() {
    if (!user) return;
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("Name is required");
      return;
    }
    if (canEditIdentity && !username.trim()) {
      setLocalError("Username is required");
      return;
    }
    if (newPassword || confirmPassword || currentPassword) {
      if (!canChangePassword) {
        setLocalError("Only you can change the Super Admin password");
        return;
      }
      if (!currentPassword) {
        setLocalError("Enter your current password to set a new one");
        return;
      }
      if (newPassword.length < 8) {
        setLocalError("New password must be at least 8 characters");
        return;
      }
      if (newPassword !== confirmPassword) {
        setLocalError("New password and confirmation do not match");
        return;
      }
    }

    try {
      await props.onSaveProfile({
        name: name.trim(),
        ...(canEditIdentity
          ? { email: email.trim(), username: username.trim() }
          : {}),
        ...(canChangePassword && newPassword
          ? { currentPassword, newPassword }
          : {}),
      });
      setEditing(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      /* parent sets actionError */
    }
  }

  return (
    <Modal
      title={user?.name ? `User · ${user.name}` : "User details"}
      onClose={props.onClose}
      wide
    >
      {props.loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {props.error ? <p className="mb-3 text-sm text-critical">{props.error}</p> : null}
      {localError ? <p className="mb-3 text-sm text-critical">{localError}</p> : null}

      {user ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* 1 · Profile */}
            <section className="flex min-h-0 flex-col rounded-xl border border-sky-200 bg-sky-50/30 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-navy-900">Profile</h4>
                {canEditProfile ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={props.busy}
                    onClick={() => {
                      setEditing((v) => !v);
                      setLocalError(null);
                    }}
                  >
                    {editing ? "Cancel edit" : "Edit details"}
                  </Button>
                ) : null}
              </div>

              {!editing ? (
                <div className="space-y-2 rounded-md border border-border bg-white px-3 py-3 text-sm">
                  <p>
                    <span className="text-slate-500">Status:</span>{" "}
                    <StatusBadge status={user.isActive ? "Active" : "Inactive"} />
                  </p>
                  <p>
                    <span className="text-slate-500">Identity:</span>{" "}
                    {user.isLocalBootstrap ? "Local Super Admin" : "HRMS-linked"}
                  </p>
                  <p>
                    <span className="text-slate-500">Name:</span> {user.name}
                  </p>
                  <p>
                    <span className="text-slate-500">Username:</span> {user.username}
                  </p>
                  <p>
                    <span className="text-slate-500">Email:</span> {user.email || "—"}
                  </p>
                  <p>
                    <span className="text-slate-500">Employee ID:</span> {user.hrmsEmployeeId || "—"}
                  </p>
                  <p>
                    <span className="text-slate-500">Last login:</span>{" "}
                    {formatLastLogin(user.lastLoginAt)}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 rounded-md border border-border bg-white px-3 py-3">
                  <label className="block text-xs font-medium text-slate-500">
                    Display name
                    <input
                      className={`${inputClass} mt-1`}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  {canEditIdentity ? (
                    <>
                      <label className="block text-xs font-medium text-slate-500">
                        Username
                        <input
                          className={`${inputClass} mt-1`}
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          autoComplete="username"
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-500">
                        Email
                        <input
                          className={`${inputClass} mt-1`}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                        />
                      </label>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Username/email for HRMS-linked users are managed in HRMS. You can update the
                      display name only.
                    </p>
                  )}

                  {canChangePassword ? (
                    <div className="space-y-2 border-t border-border pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Change password (optional)
                      </p>
                      <label className="block text-xs font-medium text-slate-500">
                        Current password
                        <input
                          type="password"
                          className={`${inputClass} mt-1`}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          autoComplete="current-password"
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-500">
                        New password
                        <input
                          type="password"
                          className={`${inputClass} mt-1`}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          autoComplete="new-password"
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-500">
                        Confirm new password
                        <input
                          type="password"
                          className={`${inputClass} mt-1`}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          autoComplete="new-password"
                        />
                      </label>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      variant="secondary"
                      disabled={props.busy}
                      onClick={() => {
                        setEditing(false);
                        setLocalError(null);
                        setName(user.name);
                        setEmail(user.email ?? "");
                        setUsername(user.username);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button disabled={props.busy} onClick={() => void save()}>
                      {props.busy ? "Saving…" : "Save details"}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* 2 · Roles & access scope */}
            <section className="flex min-h-0 flex-col rounded-xl border border-violet-200 bg-violet-50/30 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-navy-900">Roles & access scope</h4>
                {canManageRolesAndScope ? (
                  <Button size="sm" variant="secondary" onClick={props.onEditRoles}>
                    Edit roles
                  </Button>
                ) : null}
              </div>
              {bootstrapSuperAdmin ? (
                <p className="mb-2 text-xs text-slate-500">
                  System Administrator role and global scope are fixed for the bootstrap Super Admin
                  account.
                </p>
              ) : (
                <p className="mb-2 text-xs text-slate-500">
                  College → course → branch access. Use <strong className="font-medium">Edit access scope</strong>{" "}
                  on a role, or <strong className="font-medium">Edit roles</strong> for full changes.
                </p>
              )}
              {user.roles.length === 0 ? (
                <p className="text-sm text-slate-500">No roles assigned.</p>
              ) : (
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {user.roles.map((role) => (
                    <li
                      key={role.id}
                      className="rounded-md border border-border bg-white px-3 py-2.5 text-sm"
                    >
                      <p className="font-medium text-navy-900">{role.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{formatScope(role)}</p>
                      {canManageRolesAndScope ? (
                        <div className="mt-2 flex justify-end">
                          <Button size="sm" variant="secondary" onClick={() => props.onEditScope(role)}>
                            Edit access scope
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 3 · Permissions */}
            <section className="flex min-h-0 flex-col rounded-xl border border-emerald-200 bg-emerald-50/30 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-navy-900">Permissions</h4>
                {canManageRolesAndScope ? (
                  <Button size="sm" variant="secondary" onClick={props.onEditPermissions}>
                    Edit direct permissions
                  </Button>
                ) : null}
              </div>
              <p className="mb-2 text-xs text-slate-500">
                Derived from assigned roles (read-only) and direct permissions.
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {(user.permissions ?? []).length > 0 || (user.revokedPermissions ?? []).length > 0 ? (
                    <>
                      {(user.permissions ?? []).map((p) => {
                        const isRolePerm = user.rolePermissions?.includes(p);
                        const isDirectPerm = user.directPermissions?.includes(p);
                        return (
                          <span
                            key={p}
                            className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${
                              isDirectPerm && !isRolePerm
                                ? "bg-blue-50 text-blue-700 ring-blue-300 font-medium"
                                : "bg-white text-slate-700 ring-border"
                            }`}
                            title={isDirectPerm && !isRolePerm ? "Direct permission" : "Inherited from role"}
                          >
                            {p}
                          </span>
                        );
                      })}
                      {(user.revokedPermissions ?? []).map((p) => (
                        <span
                          key={`revoked-${p}`}
                          className="rounded px-1.5 py-0.5 text-[11px] ring-1 bg-red-50 text-red-700 ring-red-300 font-medium line-through opacity-75"
                          title="Explicitly revoked"
                        >
                          {p}
                        </span>
                      ))}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">No permissions derived from roles or directly.</p>
                  )}
                </div>
              </div>
            </section>
          </div>

          {props.canManage && !bootstrapSuperAdmin ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {user.isActive ? (
                <Button variant="danger" disabled={props.busy || props.isSelf} onClick={props.onDeactivate}>
                  Deactivate
                </Button>
              ) : (
                <Button disabled={props.busy} onClick={props.onActivate}>
                  Activate
                </Button>
              )}
              {!user.isLocalBootstrap ? (
                <Button variant="danger" disabled={props.busy} onClick={props.onDelete}>
                  Remove from portal
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function branchesForCollege(
  branches: Array<{ id: number; name: string; courseId: number }>,
  courses: Array<{ id: number; name?: string; collegeId: number }>,
  collegeId: string,
) {
  if (!collegeId) return branches;
  const cid = Number(collegeId);
  const courseIds = new Set(courses.filter((c) => c.collegeId === cid).map((c) => c.id));
  return branches.filter((b) => courseIds.has(b.courseId));
}

function coursesForCollegeId(
  courses: Array<{ id: number; name: string; collegeId: number }>,
  collegeId: string,
) {
  if (!collegeId) return [];
  const cid = Number(collegeId);
  return courses.filter((c) => c.collegeId === cid);
}

function branchesForCourseId(
  branches: Array<{ id: number; name: string; courseId: number }>,
  courseId: string,
) {
  if (!courseId) return [];
  const id = Number(courseId);
  return branches.filter((b) => b.courseId === id);
}

function inferCourseIdForBranch(
  branches: Array<{ id: number; name: string; courseId: number }>,
  branchId: number | null,
): string {
  if (branchId == null) return "";
  const branch = branches.find((b) => b.id === branchId);
  return branch ? String(branch.courseId) : "";
}

function RolesDialog(props: {
  user: ManagedUser;
  roles: ApRoleOption[];
  colleges: Array<{ id: number; name: string }>;
  courses: Array<{ id: number; name: string; collegeId: number }>;
  branches: Array<{ id: number; name: string; courseId: number }>;
  onClose: () => void;
  onSaved: (user: ManagedUser) => Promise<void>;
}) {
  const [rows, setRows] = useState(
    props.user.roles.map((r) => ({
      roleKey: r.roleKey,
      collegeId: r.collegeId == null ? "" : String(r.collegeId),
      courseId: inferCourseIdForBranch(props.branches, r.branchId),
      branchId: r.branchId == null ? "" : String(r.branchId),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        roleKey: props.roles[0]?.roleKey ?? "faculty",
        collegeId: "",
        courseId: "",
        branchId: "",
      },
    ]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const assignments: Array<{
        roleKey: string;
        collegeId: number | null;
        branchId: number | null;
      }> = [];

      for (const row of rows) {
        const meta = props.roles.find((r) => r.roleKey === row.roleKey);
        const global = Boolean(meta?.isGlobalCapable);
        if (global) {
          assignments.push({ roleKey: row.roleKey, collegeId: null, branchId: null });
          continue;
        }
        if (!row.collegeId) {
          throw new Error("Each non-global role needs a college");
        }
        const collegeId = Number(row.collegeId);
        // Whole college
        if (!row.courseId && !row.branchId) {
          assignments.push({ roleKey: row.roleKey, collegeId, branchId: null });
          continue;
        }
        // Course selected, all branches in course
        if (row.courseId && !row.branchId) {
          const courseBranches = branchesForCourseId(props.branches, row.courseId);
          if (!courseBranches.length) {
            throw new Error("Selected course has no branches — pick another course or whole college");
          }
          for (const branch of courseBranches) {
            assignments.push({
              roleKey: row.roleKey,
              collegeId,
              branchId: branch.id,
            });
          }
          continue;
        }
        // Specific branch
        assignments.push({
          roleKey: row.roleKey,
          collegeId,
          branchId: row.branchId ? Number(row.branchId) : null,
        });
      }

      const response = await apiFetch(`/users/${props.user.id}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to update roles");
      await props.onSaved(body as ManagedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update roles");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit roles — ${props.user.name}`} onClose={props.onClose}>
      <p className="mb-3 text-xs text-slate-500">
        Scope order: college → course → branch. Leave course/branch empty for whole-college access.
        Leave branch empty (with a course) for all branches in that course.
      </p>
      <div className="space-y-3">
        {rows.map((row, index) => {
          const meta = props.roles.find((r) => r.roleKey === row.roleKey);
          const global = Boolean(meta?.isGlobalCapable);
          const courseOptions = coursesForCollegeId(props.courses, row.collegeId);
          const branchOptions = row.courseId
            ? branchesForCourseId(props.branches, row.courseId)
            : branchesForCollege(props.branches, props.courses, row.collegeId);
          return (
            <div key={index} className="rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-medium text-slate-500">
                  Role
                  <select
                    className={`${selectClass} mt-1 w-full`}
                    value={row.roleKey}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                roleKey: e.target.value,
                                collegeId: "",
                                courseId: "",
                                branchId: "",
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {props.roles.map((r) => (
                      <option key={r.roleKey} value={r.roleKey}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!global ? (
                  <>
                    <label className="text-xs font-medium text-slate-500">
                      College
                      <select
                        className={`${selectClass} mt-1 w-full`}
                        value={row.collegeId}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    collegeId: e.target.value,
                                    courseId: "",
                                    branchId: "",
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="">Select</option>
                        {props.colleges.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-500">
                      Course
                      <select
                        className={`${selectClass} mt-1 w-full`}
                        value={row.courseId}
                        disabled={!row.collegeId}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((item, i) =>
                              i === index
                                ? { ...item, courseId: e.target.value, branchId: "" }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="">All courses (whole college)</option>
                        {courseOptions.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-500">
                      Branch
                      <select
                        className={`${selectClass} mt-1 w-full`}
                        value={row.branchId}
                        disabled={!row.collegeId}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, branchId: e.target.value } : item,
                            ),
                          )
                        }
                      >
                        <option value="">
                          {row.courseId ? "All branches in course" : "All branches in college"}
                        </option>
                        {branchOptions.map((b) => (
                          <option key={b.id} value={String(b.id)}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 sm:col-span-3 sm:self-end">Global scope</p>
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <Button className="mt-3" size="sm" variant="secondary" onClick={addRow}>
        Add role
      </Button>
      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={props.onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save roles"}
        </Button>
      </div>
    </Modal>
  );
}

function ScopeDialog(props: {
  user: ManagedUser;
  assignment: RoleAssignment;
  roles: ApRoleOption[];
  colleges: Array<{ id: number; name: string }>;
  courses: Array<{ id: number; name: string; collegeId: number }>;
  branches: Array<{ id: number; name: string; courseId: number }>;
  onClose: () => void;
  onSaved: (user: ManagedUser) => Promise<void>;
}) {
  const meta = props.roles.find((r) => r.roleKey === props.assignment.roleKey);
  const global = Boolean(meta?.isGlobalCapable);
  const [collegeId, setCollegeId] = useState(
    props.assignment.collegeId == null ? "" : String(props.assignment.collegeId),
  );
  const [courseId, setCourseId] = useState(
    inferCourseIdForBranch(props.branches, props.assignment.branchId),
  );
  const [branchId, setBranchId] = useState(
    props.assignment.branchId == null ? "" : String(props.assignment.branchId),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const courseOptions = coursesForCollegeId(props.courses, collegeId);
  const branchOptions = courseId
    ? branchesForCourseId(props.branches, courseId)
    : branchesForCollege(props.branches, props.courses, collegeId);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (global) {
        throw new Error("This role must remain globally scoped");
      }
      if (!collegeId) throw new Error("College is required");
      const nextCollegeId = Number(collegeId);
      const roleKey = props.assignment.roleKey;

      // Course with no specific branch → expand to all branches in that course
      // via full roles replace (single assignment row can't hold multi-branch).
      if (courseId && !branchId) {
        const courseBranches = branchesForCourseId(props.branches, courseId);
        if (!courseBranches.length) {
          throw new Error("Selected course has no branches");
        }
        const other = props.user.roles
          .filter((r) => r.id !== props.assignment.id)
          .map((r) => ({
            roleKey: r.roleKey,
            collegeId: r.collegeId,
            branchId: r.branchId,
          }));
        const expanded = courseBranches.map((b) => ({
          roleKey,
          collegeId: nextCollegeId,
          branchId: b.id,
        }));
        const response = await apiFetch(`/users/${props.user.id}/roles`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments: [...other, ...expanded] }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.message || "Failed to update scope");
        await props.onSaved(body as ManagedUser);
        return;
      }

      const response = await apiFetch(`/users/${props.user.id}/scope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: props.assignment.id,
          collegeId: nextCollegeId,
          branchId: branchId ? Number(branchId) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to update scope");
      await props.onSaved(body as ManagedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update scope");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit access scope — ${props.assignment.label}`} onClose={props.onClose}>
      {global ? (
        <p className="text-sm text-slate-600">This role must remain globally scoped.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-slate-500">
            College
            <select
              className={`${selectClass} mt-1 w-full`}
              value={collegeId}
              onChange={(e) => {
                setCollegeId(e.target.value);
                setCourseId("");
                setBranchId("");
              }}
            >
              <option value="">Select</option>
              {props.colleges.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Course
            <select
              className={`${selectClass} mt-1 w-full`}
              value={courseId}
              disabled={!collegeId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setBranchId("");
              }}
            >
              <option value="">All courses (whole college)</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Branch
            <select
              className={`${selectClass} mt-1 w-full`}
              value={branchId}
              disabled={!collegeId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">
                {courseId ? "All branches in this course" : "All branches in college"}
              </option>
              {branchOptions.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={props.onClose}>
          Cancel
        </Button>
        <Button disabled={busy || global} onClick={() => void save()}>
          {busy ? "Saving…" : "Save scope"}
        </Button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl ${
          wide ? "max-w-6xl" : "max-w-2xl"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-white px-5 py-3">
          <h3 className="font-semibold text-navy-900">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
