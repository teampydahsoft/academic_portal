"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import type { ManagedRole, PermissionCatalogItem } from "@/features/user-management/types";
import {
  PERMISSION_MATRIX_MODULES,
  PERMISSION_PRESENTATION,
  allMatrixPermissionKeys,
  moduleAccessState,
  summarizeRoleAccess,
  type MatrixModuleDef,
} from "@/features/user-management/permission-matrix";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800";

type Props = {
  canManage: boolean;
};

function groupModules(modules: MatrixModuleDef[]) {
  const groups: { title: string; items: MatrixModuleDef[] }[] = [];
  for (const mod of modules) {
    const existing = groups.find((g) => g.title === mod.group);
    if (existing) existing.items.push(mod);
    else groups.push({ title: mod.group, items: [mod] });
  }
  return groups;
}

function sortedKeys(keys: string[]) {
  return [...keys].sort().join("\0");
}

export function RolesPermissionsPanel({ canManage }: Props) {
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGlobal, setEditGlobal] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newGlobal, setNewGlobal] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    role: ManagedRole;
    mode: "blocked" | "confirm" | "protected";
  } | null>(null);

  const selected = roles.find((r) => r.id === selectedId) ?? null;
  const enabled = useMemo(() => new Set(draftKeys), [draftKeys]);
  const summary = useMemo(() => summarizeRoleAccess(enabled), [enabled]);
  const navGroups = useMemo(() => groupModules(PERMISSION_MATRIX_MODULES), []);

  const catalogKeys = useMemo(
    () => new Set(catalog.map((p) => p.permissionKey)),
    [catalog],
  );

  const unmappedCatalog = useMemo(() => {
    const matrixKeys = new Set(allMatrixPermissionKeys());
    return catalog.filter((p) => !matrixKeys.has(p.permissionKey));
  }, [catalog]);

  const missingFromApi = useMemo(() => {
    return allMatrixPermissionKeys().filter((k) => catalog.length > 0 && !catalogKeys.has(k));
  }, [catalog.length, catalogKeys]);

  const savedPermKey = selected ? sortedKeys(selected.permissions) : "";
  const draftPermKey = sortedKeys(draftKeys);
  const permissionsDirty = Boolean(selected) && draftPermKey !== savedPermKey;
  const detailsDirty = selected
    ? editLabel.trim() !== selected.label ||
      (editDescription.trim() || "") !== (selected.description ?? "") ||
      editGlobal !== selected.isGlobalCapable
    : false;
  const dirty = permissionsDirty || detailsDirty;

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        apiFetch("/roles?includeInactive=true", { cache: "no-store" }),
        apiFetch("/permissions", { cache: "no-store" }),
      ]);
      const rolesBody = await rolesRes.json().catch(() => ({}));
      const permsBody = await permsRes.json().catch(() => ({}));
      if (!rolesRes.ok) throw new Error(rolesBody?.message || "Failed to load roles");
      if (!permsRes.ok) throw new Error(permsBody?.message || "Failed to load permissions");
      const roleRows = (rolesBody.data ?? []) as ManagedRole[];
      setRoles(roleRows);
      setCatalog(permsBody.data ?? []);
      setSelectedId((prev) => prev ?? roleRows[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setDraftKeys([...selected.permissions]);
    setEditLabel(selected.label);
    setEditDescription(selected.description ?? "");
    setEditGlobal(selected.isGlobalCapable);
    setEditingDetails(false);
  }, [selected?.id, savedPermKey, selected?.label, selected?.description, selected?.isGlobalCapable]);

  function discardChanges() {
    if (!selected) return;
    setDraftKeys([...selected.permissions]);
    setEditLabel(selected.label);
    setEditDescription(selected.description ?? "");
    setEditGlobal(selected.isGlobalCapable);
    setEditingDetails(false);
    setError(null);
    setSuccess(null);
  }

  function selectRole(id: number) {
    if (id === selectedId) return;
    if (dirty && !window.confirm("You have unsaved changes. Discard them and switch roles?")) {
      return;
    }
    setSuccess(null);
    setError(null);
    setSelectedId(id);
  }

  function toggleKey(key: string, on: boolean) {
    setDraftKeys((prev) => {
      if (on) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((k) => k !== key);
    });
    setSuccess(null);
  }

  function applyModuleLevel(mod: MatrixModuleDef, level: "none" | "view" | "manage") {
    const reads = mod.permissions.filter((p) => p.kind === "read").map((p) => p.key);
    const writes = mod.permissions.filter((p) => p.kind === "write").map((p) => p.key);
    setDraftKeys((prev) => {
      const next = new Set(prev);
      if (level === "none") {
        for (const k of [...reads, ...writes]) next.delete(k);
      } else if (level === "view") {
        for (const k of writes) next.delete(k);
        for (const k of reads) next.add(k);
      } else {
        for (const k of [...reads, ...writes]) next.add(k);
      }
      return [...next];
    });
    setSuccess(null);
  }

  async function saveRoleDetails(confirmImpact = false) {
    if (!selected || !canManage || !detailsDirty) return true;
    const response = await apiFetch(`/roles/${selected.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: editLabel.trim(),
        description: editDescription.trim() || null,
        isGlobalCapable: editGlobal,
        confirmImpact,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (/confirmImpact/i.test(String(body?.message ?? ""))) {
        const ok = window.confirm(
          `${body.message}\n\nThis will revoke sessions for users with this role. Continue?`,
        );
        if (ok) return saveRoleDetails(true);
        return false;
      }
      throw new Error(body?.message || "Failed to update role");
    }
    return true;
  }

  async function savePermissionsOnly(confirmImpact = false) {
    if (!selected || !canManage || !permissionsDirty) return true;
    const response = await apiFetch(`/roles/${selected.id}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissionKeys: draftKeys, confirmImpact }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (/confirmImpact/i.test(String(body?.message ?? ""))) {
        const ok = window.confirm(
          `${body.message}\n\nThis will revoke sessions for users with this role. Continue?`,
        );
        if (ok) return savePermissionsOnly(true);
        return false;
      }
      throw new Error(body?.message || "Failed to save permissions");
    }
    return true;
  }

  async function saveAll() {
    if (!selected || !canManage || !dirty) return;
    const savedDetails = detailsDirty;
    const savedPerms = permissionsDirty;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const detailsOk = await saveRoleDetails(false);
      if (!detailsOk) return;
      const permsOk = await savePermissionsOnly(false);
      if (!permsOk) return;
      await load({ soft: true });
      setEditingDetails(false);
      setSuccess(
        savedDetails && savedPerms
          ? "Role details and permissions saved."
          : savedPerms
            ? "Permissions saved."
            : "Role details saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!selected || !canManage) return;
    if (dirty && !window.confirm("You have unsaved changes. Continue and discard them?")) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiFetch(`/roles/${selected.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !selected.isActive, confirmImpact: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to update status");
      await load({ soft: true });
      setSuccess(selected.isActive ? "Role deactivated." : "Role activated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  async function createRole() {
    if (!canManage || !newLabel.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiFetch("/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel.trim(),
          description: newDescription.trim() || null,
          isGlobalCapable: newGlobal,
          permissionKeys: [],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to create role");
      const createdId = Number(body?.id ?? body?.data?.id);
      setCreateOpen(false);
      setNewLabel("");
      setNewDescription("");
      setNewGlobal(false);
      await load({ soft: true });
      if (Number.isFinite(createdId) && createdId > 0) setSelectedId(createdId);
      setSuccess("Role created. Assign permissions below, then save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setBusy(false);
    }
  }

  function openDeleteDialog() {
    if (!selected || !canManage) return;

    if (selected.roleKey === "system_admin") {
      setDeleteDialog({ role: selected, mode: "protected" });
      return;
    }

    if (Number(selected.assignmentCount ?? 0) > 0) {
      setDeleteDialog({ role: selected, mode: "blocked" });
      setError(null);
      setSuccess(null);
      return;
    }

    setDeleteDialog({ role: selected, mode: "confirm" });
  }

  async function executeDeleteRole(role: ManagedRole) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const qs = role.isSystemRole ? "?confirmImpact=true" : "";
      const response = await apiFetch(`/roles/${role.id}${qs}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body?.code === "ROLE_HAS_ASSIGNMENTS" || response.status === 409) {
          const refreshed = {
            ...role,
            assignmentCount: Number(body?.assignmentCount ?? role.assignmentCount ?? 0),
            activeUserCount: Number(body?.activeUserCount ?? role.activeUserCount ?? 0),
          };
          setDeleteDialog({ role: refreshed, mode: "blocked" });
          throw new Error(body?.message || "Cannot delete: users still assigned to this role.");
        }
        throw new Error(body?.message || "Failed to delete role");
      }
      setDeleteDialog(null);
      setSelectedId(null);
      await load({ soft: true });
      setSuccess(`Role “${role.label}” deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading roles & permissions…</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="h-fit">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-navy-900">Roles</h3>
          {canManage ? (
            <Button variant="secondary" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? "Cancel" : "Create"}
            </Button>
          ) : null}
        </div>
        {createOpen ? (
          <div className="mb-4 space-y-2 rounded-md border border-border p-3">
            <input
              className={inputClass}
              placeholder="Role name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={newGlobal}
                onChange={(e) => setNewGlobal(e.target.checked)}
              />
              Global-capable (NULL college/branch only)
            </label>
            <Button disabled={busy || !newLabel.trim()} onClick={() => void createRole()}>
              Save role
            </Button>
          </div>
        ) : null}
        <ul className="space-y-1">
          {roles.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                  selectedId === role.id ? "bg-navy-50 text-navy-900" : "hover:bg-slate-50"
                }`}
                onClick={() => selectRole(role.id)}
              >
                <span>
                  {role.label}
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {role.roleKey}
                    {Number(role.activeUserCount ?? 0) > 0
                      ? ` · ${role.activeUserCount} active`
                      : role.assignmentCount > 0
                        ? ` · ${role.assignmentCount} assigned`
                        : ""}
                  </span>
                </span>
                <StatusBadge status={role.isActive ? "active" : "inactive"} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-4">
        {error ? (
          <Card>
            <p className="text-sm text-critical">{error}</p>
          </Card>
        ) : null}
        {success ? (
          <Card>
            <p className="text-sm text-emerald-700">{success}</p>
          </Card>
        ) : null}

        {!selected ? (
          <Card>
            <p className="text-sm text-slate-500">Select a role to edit details and permissions.</p>
          </Card>
        ) : (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-navy-900">Role: {selected.label}</h3>
                    {dirty ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Unsaved changes
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500">
                    {selected.roleKey}
                    {selected.isSystemRole ? " · system role (editable)" : " · custom role"}
                    {selected.isGlobalCapable ? " · global-capable" : ""}
                    {` · ${selected.assignmentCount} user${selected.assignmentCount === 1 ? "" : "s"} assigned`}
                    {Number(selected.activeUserCount ?? 0) > 0
                      ? ` · ${selected.activeUserCount} active`
                      : ""}
                  </p>
                  {!editingDetails && selected.description ? (
                    <p className="mt-1 text-sm text-slate-600">{selected.description}</p>
                  ) : null}
                  {selected.assignmentCount > 0 && selected.roleKey !== "system_admin" ? (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {Number(selected.activeUserCount ?? 0) > 0 ? (
                        <>
                          Warning: {selected.activeUserCount} active user
                          {Number(selected.activeUserCount) === 1 ? "" : "s"} still ha
                          {Number(selected.activeUserCount) === 1 ? "s" : "ve"} this role. Delete is
                          blocked until you reassign them in All Users.
                        </>
                      ) : (
                        <>
                          Warning: {selected.assignmentCount} inactive user
                          {selected.assignmentCount === 1 ? "" : "s"} still ha
                          {selected.assignmentCount === 1 ? "s" : "ve"} this role. Reassign or remove
                          the role from those users before deleting.
                        </>
                      )}
                    </p>
                  ) : null}
                  {selected.roleKey === "system_admin" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      System Administrator cannot be deleted (protects portal admin access). You can
                      edit permissions or deactivate other roles instead.
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditingDetails((v) => !v);
                        setSuccess(null);
                      }}
                    >
                      {editingDetails ? "Close edit" : "Edit role"}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void toggleActive()}>
                      {selected.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    {selected.roleKey !== "system_admin" ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => openDeleteDialog()}
                        title={
                          selected.assignmentCount > 0
                            ? "Blocked while users still have this role"
                            : selected.isSystemRole
                              ? "Delete this seeded role"
                              : "Delete this custom role"
                        }
                      >
                        Delete
                        {selected.assignmentCount > 0 ? " (blocked)" : ""}
                      </Button>
                    ) : null}
                    {dirty ? (
                      <Button variant="secondary" disabled={busy} onClick={discardChanges}>
                        Discard
                      </Button>
                    ) : null}
                    <Button disabled={busy || !dirty} onClick={() => void saveAll()}>
                      Save changes
                    </Button>
                  </div>
                ) : null}
              </div>

              {canManage && editingDetails ? (
                <div className="mt-4 space-y-3 rounded-md border border-border bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-600">
                    Edit role details
                    {selected.isSystemRole
                      ? " — seeded system roles can be renamed; role key stays fixed."
                      : null}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-600">
                      Display name
                      <input
                        className={`${inputClass} mt-1`}
                        value={editLabel}
                        disabled={busy}
                        onChange={(e) => {
                          setEditLabel(e.target.value);
                          setSuccess(null);
                        }}
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      Role key
                      <input className={`${inputClass} mt-1 bg-slate-100`} value={selected.roleKey} disabled />
                    </label>
                  </div>
                  <label className="block text-xs text-slate-600">
                    Description
                    <textarea
                      className="mt-1 min-h-[72px] w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-navy-800"
                      value={editDescription}
                      disabled={busy}
                      onChange={(e) => {
                        setEditDescription(e.target.value);
                        setSuccess(null);
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={editGlobal}
                      disabled={
                        busy ||
                        (selected.isSystemRole && selected.isGlobalCapable)
                      }
                      onChange={(e) => {
                        setEditGlobal(e.target.checked);
                        setSuccess(null);
                      }}
                    />
                    Global-capable (college/branch scope can be NULL)
                    {selected.isSystemRole && selected.isGlobalCapable
                      ? " — locked for this system role"
                      : null}
                  </label>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Modules with access</p>
                  <p className="text-lg font-semibold text-navy-900">{summary.modulesWithAccess}</p>
                </div>
                <div className="rounded-md border border-border bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Read permissions</p>
                  <p className="text-lg font-semibold text-navy-900">{summary.read}</p>
                </div>
                <div className="rounded-md border border-border bg-slate-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Write / action</p>
                  <p className="text-lg font-semibold text-navy-900">{summary.write}</p>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Toggle permissions below, then click Save changes. Applies to seeded and custom roles.
                Saving updates the database and revokes sessions for users with this role.
              </p>
            </Card>

            {navGroups.map((group) => (
              <Card key={group.title}>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.title}
                </h4>
                <div className="space-y-5">
                  {group.items.map((mod) => {
                    const level = moduleAccessState(mod, enabled);
                    const reads = mod.permissions.filter((p) => p.kind === "read");
                    const writes = mod.permissions.filter((p) => p.kind === "write");
                    const hasWrites = writes.length > 0;

                    return (
                      <div key={mod.href} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h5 className="text-sm font-semibold text-navy-900">{mod.label}</h5>
                            {mod.accessNote ? (
                              <p className="text-[11px] text-slate-500">{mod.accessNote}</p>
                            ) : null}
                          </div>
                          {canManage ? (
                            <div className="flex flex-wrap gap-1">
                              <ModuleLevelButton
                                active={level === "none"}
                                disabled={busy}
                                label="No access"
                                onClick={() => applyModuleLevel(mod, "none")}
                              />
                              <ModuleLevelButton
                                active={level === "view"}
                                disabled={busy || reads.length === 0}
                                label="View"
                                onClick={() => applyModuleLevel(mod, "view")}
                              />
                              {hasWrites ? (
                                <ModuleLevelButton
                                  active={level === "manage"}
                                  disabled={busy}
                                  label="Manage"
                                  onClick={() => applyModuleLevel(mod, "manage")}
                                />
                              ) : null}
                              {level === "partial" ? (
                                <span className="self-center text-[11px] text-amber-700">Partial</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {reads.length > 0 ? (
                          <PermissionSection
                            title="Read access"
                            items={reads}
                            enabled={enabled}
                            canManage={canManage}
                            busy={busy}
                            onToggle={toggleKey}
                          />
                        ) : null}
                        {writes.length > 0 ? (
                          <PermissionSection
                            title="Write / action access"
                            items={writes}
                            enabled={enabled}
                            canManage={canManage}
                            busy={busy}
                            onToggle={toggleKey}
                            className="mt-3"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}

            {unmappedCatalog.length > 0 ? (
              <Card>
                <h4 className="mb-2 text-sm font-semibold text-navy-900">Additional catalog permissions</h4>
                <p className="mb-3 text-xs text-slate-500">
                  Present in the API catalog but not tied to a current sidebar item.
                </p>
                <PermissionSection
                  title="Other"
                  items={unmappedCatalog.map((p) => ({
                    key: p.permissionKey,
                    label: p.displayName || p.permissionKey,
                    description: p.description || PERMISSION_PRESENTATION[p.permissionKey]?.description || "",
                    kind: p.permissionKey.includes(".view") ? ("read" as const) : ("write" as const),
                    sensitive: Boolean(PERMISSION_PRESENTATION[p.permissionKey]?.sensitive),
                  }))}
                  enabled={enabled}
                  canManage={canManage}
                  busy={busy}
                  onToggle={toggleKey}
                />
              </Card>
            ) : null}

            {missingFromApi.length > 0 ? (
              <Card>
                <p className="text-sm text-amber-800">
                  Matrix references keys missing from the live catalog: {missingFromApi.join(", ")}
                </p>
              </Card>
            ) : null}
          </>
        )}
      </div>

      {deleteDialog ? (
        <DeleteRoleModal
          role={deleteDialog.role}
          mode={deleteDialog.mode}
          busy={busy}
          onClose={() => {
            if (!busy) setDeleteDialog(null);
          }}
          onConfirm={() => void executeDeleteRole(deleteDialog.role)}
        />
      ) : null}
    </div>
  );
}

function DeleteRoleModal(props: {
  role: ManagedRole;
  mode: "blocked" | "confirm" | "protected";
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const activeUsers = Number(props.role.activeUserCount ?? 0);
  const assignedUsers = Number(props.role.assignmentCount ?? 0);
  const inactiveUsers = Math.max(0, assignedUsers - activeUsers);

  const title =
    props.mode === "confirm"
      ? "Delete role?"
      : props.mode === "blocked"
        ? "Cannot delete role"
        : "Role protected";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        disabled={props.busy}
        onClick={props.onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-role-title"
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-white shadow-xl"
      >
        <div className="border-b border-border px-5 py-3">
          <h3 id="delete-role-title" className="text-base font-semibold text-navy-900">
            {title}
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">{props.role.label}</p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {props.mode === "protected" ? (
            <>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <span className="font-semibold text-navy-900">System Administrator</span> cannot be
                deleted. It protects portal administration access.
              </p>
              <p className="text-sm text-slate-600">
                You can edit its permissions or deactivate other roles instead.
              </p>
            </>
          ) : null}

          {props.mode === "blocked" ? (
            <>
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                This role still has users assigned, so delete is blocked.
              </p>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {activeUsers > 0 ? (
                  <li>
                    <span className="font-semibold text-navy-900">{activeUsers}</span> active user
                    {activeUsers === 1 ? "" : "s"} currently ha
                    {activeUsers === 1 ? "s" : "ve"} this role
                  </li>
                ) : null}
                {inactiveUsers > 0 ? (
                  <li>
                    <span className="font-semibold text-navy-900">{inactiveUsers}</span> inactive user
                    {inactiveUsers === 1 ? "" : "s"} still ha
                    {inactiveUsers === 1 ? "s" : "ve"} this role
                  </li>
                ) : null}
              </ul>
              <p className="text-sm text-slate-600">
                Open <span className="font-medium text-navy-900">All Users</span>, remove or change
                this role for those people, then try Delete again.
              </p>
            </>
          ) : null}

          {props.mode === "confirm" ? (
            <>
              {props.role.isSystemRole ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                  This is a seeded system role. Deleting it removes it from Role Configuration
                  permanently.
                </p>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  No users are assigned to this role.
                </p>
              )}
              <p className="text-sm text-slate-700">
                This permanently removes <span className="font-semibold">{props.role.label}</span> and
                its permission mapping. This cannot be undone.
              </p>
              <p className="text-xs text-slate-500">
                Role key: <span className="font-mono">{props.role.roleKey}</span>
              </p>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-slate-50 px-5 py-3">
          <Button variant="secondary" disabled={props.busy} onClick={props.onClose}>
            {props.mode === "confirm" ? "Cancel" : "Close"}
          </Button>
          {props.mode === "confirm" ? (
            <Button variant="danger" disabled={props.busy} onClick={props.onConfirm}>
              {props.busy ? "Deleting…" : "Delete role"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModuleLevelButton(props: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
        props.active
          ? "border-navy-800 bg-navy-800 text-white"
          : "border-border bg-white text-slate-600 hover:border-navy-700/40"
      } disabled:opacity-50`}
    >
      {props.label}
    </button>
  );
}

function PermissionSection(props: {
  title: string;
  items: Array<{
    key: string;
    label: string;
    description: string;
    kind: "read" | "write";
    sensitive?: boolean;
  }>;
  enabled: Set<string>;
  canManage: boolean;
  busy: boolean;
  onToggle: (key: string, on: boolean) => void;
  className?: string;
}) {
  return (
    <div className={props.className}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {props.title}
      </p>
      <div className="space-y-2">
        {props.items.map((perm) => {
          const checked = props.enabled.has(perm.key);
          return (
            <label
              key={`${props.title}-${perm.key}`}
              className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm ${
                perm.sensitive ? "border-amber-200 bg-amber-50/40" : "border-border bg-white"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1"
                disabled={!props.canManage || props.busy}
                checked={checked}
                onChange={(e) => props.onToggle(perm.key, e.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-navy-900">{perm.label}</span>
                  {perm.sensitive ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                      Sensitive action
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-slate-600">{perm.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
