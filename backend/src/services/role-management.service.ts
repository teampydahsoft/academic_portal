import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import {
  getRoleMetaByKey,
  invalidateAuthzCache,
  listUserIdsWithRole,
} from "../authz/authorization.service.js";
import { revokeAllSessionsForUser } from "./auth.service.js";
import { writeAuditLog } from "./audit.service.js";
import { countActiveWorkflowReferencesForRole } from "./request-workflow-admin.service.js";
import { STANDARD_ROLE_KEYS } from "../authz/permissions.js";

const PORTAL_ADMIN_PERMISSION_KEYS = [
  "user_management.manage_users",
  "roles.manage",
] as const;

function portalAdminPermissionSql(alias = "p") {
  const placeholders = PORTAL_ADMIN_PERMISSION_KEYS.map(() => "?").join(", ");
  return `${alias}.permission_key IN (${placeholders})`;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t || null;
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function slugifyRoleKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `role_${Date.now()}`;
}

type RoleRow = RowDataPacket & {
  id: number;
  role_key: string;
  label: string;
  description: string | null;
  is_system_role: number;
  is_active: number;
  is_global_capable: number;
  created_at: string | Date | null;
  updated_at: string | Date | null;
  assignment_count?: number;
  active_user_count?: number;
};

export type PermissionDto = {
  id: number;
  permissionKey: string;
  module: string;
  action: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
};

export type RoleDetailDto = {
  id: number;
  roleKey: string;
  label: string;
  description: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  isGlobalCapable: boolean;
  /** Distinct portal users who have this role (any status). */
  assignmentCount: number;
  /** Distinct active portal users who have this role. */
  activeUserCount: number;
  permissions: string[];
  permissionIds: number[];
  createdAt: string | null;
  updatedAt: string | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export async function listPermissionsCatalog(): Promise<PermissionDto[]> {
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      permission_key: string;
      module: string;
      action: string;
      display_name: string;
      description: string | null;
      is_active: number;
    })[]
  >(
    `
    SELECT id, permission_key, module, action, display_name, description, is_active
    FROM ap_permissions
    WHERE is_active = 1
    ORDER BY module, action, permission_key
    `,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    permissionKey: String(row.permission_key),
    module: String(row.module),
    action: String(row.action),
    displayName: String(row.display_name),
    description: text(row.description),
    isActive: Number(row.is_active) === 1,
  }));
}

async function loadRolePermissionKeys(roleId: number): Promise<{ keys: string[]; ids: number[] }> {
  const rows = await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
    `
    SELECT p.id, p.permission_key
    FROM ap_role_permissions rp
    INNER JOIN ap_permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ? AND p.is_active = 1
    ORDER BY p.permission_key
    `,
    [roleId],
  );
  return {
    keys: rows.map((r) => String(r.permission_key)),
    ids: rows.map((r) => Number(r.id)),
  };
}

function mapRole(row: RoleRow, permissions: string[], permissionIds: number[]): RoleDetailDto {
  return {
    id: Number(row.id),
    roleKey: String(row.role_key),
    label: String(row.label),
    description: text(row.description),
    isSystemRole: Number(row.is_system_role) === 1,
    isActive: Number(row.is_active) === 1,
    isGlobalCapable: Number(row.is_global_capable) === 1,
    assignmentCount: Number(row.assignment_count ?? 0),
    activeUserCount: Number(row.active_user_count ?? 0),
    permissions,
    permissionIds,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const ROLE_ASSIGNMENT_COUNTS_SQL = `
  (
    SELECT COUNT(DISTINCT ur.user_id)
    FROM ap_user_roles ur
    WHERE ur.role_id = r.id
  ) AS assignment_count,
  (
    SELECT COUNT(DISTINCT ur.user_id)
    FROM ap_user_roles ur
    INNER JOIN ap_users u ON u.id = ur.user_id
    WHERE ur.role_id = r.id
      AND u.is_active = 1
  ) AS active_user_count
`;

export async function listManagedRoles(includeInactive = true): Promise<RoleDetailDto[]> {
  const rows = await queryAcademic<RoleRow[]>(
    `
    SELECT
      r.id, r.role_key, r.label, r.description,
      r.is_system_role, r.is_active, r.is_global_capable,
      r.created_at, r.updated_at,
      ${ROLE_ASSIGNMENT_COUNTS_SQL}
    FROM ap_roles r
    WHERE r.role_key IN (${STANDARD_ROLE_KEYS.map(() => "?").join(", ")})
      AND (? = 1 OR r.is_active = 1)
    ORDER BY FIELD(r.role_key, ${STANDARD_ROLE_KEYS.map(() => "?").join(", ")})
    `,
    [...STANDARD_ROLE_KEYS, includeInactive ? 1 : 0, ...STANDARD_ROLE_KEYS],
  );

  const result: RoleDetailDto[] = [];
  for (const row of rows) {
    const perms = await loadRolePermissionKeys(Number(row.id));
    result.push(mapRole(row, perms.keys, perms.ids));
  }
  return result;
}

export async function getManagedRole(roleId: number): Promise<RoleDetailDto | null> {
  const rows = await queryAcademic<RoleRow[]>(
    `
    SELECT
      r.id, r.role_key, r.label, r.description,
      r.is_system_role, r.is_active, r.is_global_capable,
      r.created_at, r.updated_at,
      ${ROLE_ASSIGNMENT_COUNTS_SQL}
    FROM ap_roles r
    WHERE r.id = ?
    LIMIT 1
    `,
    [roleId],
  );
  const row = rows[0];
  if (!row) return null;
  const perms = await loadRolePermissionKeys(roleId);
  return mapRole(row, perms.keys, perms.ids);
}

async function countActiveGlobalSystemAdmins(excludeUserId?: number) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(DISTINCT u.id) AS c
    FROM ap_users u
    INNER JOIN ap_user_roles ur ON ur.user_id = u.id
    INNER JOIN ap_roles r ON r.id = ur.role_id
    INNER JOIN ap_role_permissions rp ON rp.role_id = r.id
    INNER JOIN ap_permissions p ON p.id = rp.permission_id
    WHERE u.is_active = 1
      AND r.is_active = 1
      AND r.role_key = 'super_admin'
      AND ur.college_id IS NULL
      AND ur.branch_id IS NULL
      AND ${portalAdminPermissionSql("p")}
      AND p.is_active = 1
      AND (? IS NULL OR u.id <> ?)
    `,
    [...PORTAL_ADMIN_PERMISSION_KEYS, excludeUserId ?? null, excludeUserId ?? null],
  );
  return Number(rows[0]?.c ?? 0);
}

async function roleHasPortalAdminPermission(roleId: number) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM ap_role_permissions rp
    INNER JOIN ap_permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?
      AND ${portalAdminPermissionSql("p")}
      AND p.is_active = 1
    `,
    [roleId, ...PORTAL_ADMIN_PERMISSION_KEYS],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function revokeSessionsForRole(roleId: number) {
  const userIds = await listUserIdsWithRole(roleId);
  let revoked = 0;
  for (const userId of userIds) {
    revoked += await revokeAllSessionsForUser(userId);
    invalidateAuthzCache({ userId });
  }
  invalidateAuthzCache({ roleId });
  return { userIds, revoked };
}

export async function createRole(input: {
  label: string;
  description?: string | null;
  roleKey?: string | null;
  isGlobalCapable?: boolean;
  permissionKeys?: string[];
  actorUserId: number;
  ipAddress?: string | null;
}) {
  fail(
    400,
    `Custom roles are disabled. Use one of: ${STANDARD_ROLE_KEYS.join(", ")}`,
  );
}

export async function updateRole(input: {
  roleId: number;
  label?: string;
  description?: string | null;
  isGlobalCapable?: boolean;
  actorUserId: number;
  ipAddress?: string | null;
  confirmImpact?: boolean;
}) {
  const existing = await getManagedRole(input.roleId);
  if (!existing) fail(404, "Role not found");

  if (existing.isSystemRole && input.isGlobalCapable === false && existing.isGlobalCapable) {
    fail(400, "Cannot remove global capability from a system role");
  }

  const label = input.label != null ? text(input.label) : existing.label;
  if (!label) fail(400, "Role name is required");

  if (
    existing.roleKey === "super_admin" &&
    input.isGlobalCapable === false &&
    !input.confirmImpact
  ) {
    fail(400, "Confirm impact before changing super_admin global capability");
  }

  await executeAcademic(
    `
    UPDATE ap_roles
    SET label = ?,
        description = ?,
        is_global_capable = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      label,
      input.description !== undefined ? text(input.description) : existing.description,
      input.isGlobalCapable != null
        ? input.isGlobalCapable
          ? 1
          : 0
        : existing.isGlobalCapable
          ? 1
          : 0,
      input.roleId,
    ],
  );

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "role.updated",
    entityType: "ap_role",
    entityId: input.roleId,
    oldValue: {
      label: existing.label,
      description: existing.description,
      isGlobalCapable: existing.isGlobalCapable,
    },
    newValue: {
      label,
      description:
        input.description !== undefined ? text(input.description) : existing.description,
      isGlobalCapable:
        input.isGlobalCapable != null ? Boolean(input.isGlobalCapable) : existing.isGlobalCapable,
    },
    ipAddress: input.ipAddress,
  });

  await revokeSessionsForRole(input.roleId);
  return getManagedRole(input.roleId);
}

export async function setRoleActiveStatus(input: {
  roleId: number;
  isActive: boolean;
  actorUserId: number;
  ipAddress?: string | null;
  confirmImpact?: boolean;
}) {
  const existing = await getManagedRole(input.roleId);
  if (!existing) fail(404, "Role not found");

  if (!input.isActive && existing.roleKey === "super_admin") {
    const remaining = await countActiveGlobalSystemAdmins();
    // Deactivating super_admin role affects all holders
    if (remaining > 0 && !input.confirmImpact) {
      fail(
        400,
        "Deactivating super_admin will remove portal administration for its assignees. Pass confirmImpact=true to proceed only if another admin path exists.",
      );
    }
    // Hard stop if this would leave zero manage_users admins via super_admin
    if (existing.isActive && !input.isActive) {
      // After deactivation, no super_admin role permissions apply
      const otherAdmins = await queryAcademic<(RowDataPacket & { c: number })[]>(
        `
        SELECT COUNT(DISTINCT u.id) AS c
        FROM ap_users u
        INNER JOIN ap_user_roles ur ON ur.user_id = u.id
        INNER JOIN ap_roles r ON r.id = ur.role_id
        INNER JOIN ap_role_permissions rp ON rp.role_id = r.id
        INNER JOIN ap_permissions p ON p.id = rp.permission_id
        WHERE u.is_active = 1
          AND r.is_active = 1
          AND r.id <> ?
          AND ${portalAdminPermissionSql("p")}
          AND p.is_active = 1
        `,
        [input.roleId, ...PORTAL_ADMIN_PERMISSION_KEYS],
      );
      if (Number(otherAdmins[0]?.c ?? 0) === 0) {
        fail(400, "Cannot deactivate the only role that grants portal administration");
      }
    }
  }

  await executeAcademic(
    `UPDATE ap_roles SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [input.isActive ? 1 : 0, input.roleId],
  );

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: input.isActive ? "role.activated" : "role.deactivated",
    entityType: "ap_role",
    entityId: input.roleId,
    oldValue: { isActive: existing.isActive },
    newValue: { isActive: input.isActive },
    ipAddress: input.ipAddress,
  });

  await revokeSessionsForRole(input.roleId);
  return getManagedRole(input.roleId);
}

export async function deleteRole(input: {
  roleId: number;
  actorUserId: number;
  ipAddress?: string | null;
  confirmImpact?: boolean;
}) {
  const existing = await getManagedRole(input.roleId);
  if (!existing) fail(404, "Role not found");

  // Keep the portal administration role — deleting it risks permanent lockout.
  if (existing.roleKey === "super_admin") {
    fail(
      400,
      "System Administrator cannot be deleted. Reassign users or deactivate other roles instead.",
    );
  }

  if (existing.assignmentCount > 0) {
    const active = existing.activeUserCount;
    const inactive = Math.max(0, existing.assignmentCount - active);
    const parts: string[] = [];
    if (active > 0) {
      parts.push(
        `${active} active user${active === 1 ? "" : "s"} still ha${active === 1 ? "s" : "ve"} this role`,
      );
    }
    if (inactive > 0) {
      parts.push(
        `${inactive} inactive user${inactive === 1 ? "" : "s"} still ha${inactive === 1 ? "s" : "ve"} this role`,
      );
    }
    const detail = parts.join("; ");
    const err = Object.assign(
      new Error(
        `Cannot delete “${existing.label}”: ${detail}. Reassign or remove this role from those users first.`,
      ),
      {
        status: 409,
        code: "ROLE_HAS_ASSIGNMENTS",
        assignmentCount: existing.assignmentCount,
        activeUserCount: active,
      },
    );
    throw err;
  }

  if (existing.isSystemRole && !input.confirmImpact) {
    fail(
      400,
      "This is a seeded system role. Pass confirmImpact=true to permanently delete it.",
    );
  }

  const workflowRefs = await countActiveWorkflowReferencesForRole(existing.roleKey);
  if (workflowRefs > 0) {
    fail(
      409,
      `Cannot delete “${existing.label}”: this role is required by ${workflowRefs} active workflow step${workflowRefs === 1 ? "" : "s"}. Update those workflows first.`,
    );
  }

  await executeAcademic(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [input.roleId]);
  await executeAcademic(`DELETE FROM ap_roles WHERE id = ?`, [input.roleId]);

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "role.deleted",
    entityType: "ap_role",
    entityId: input.roleId,
    oldValue: {
      roleKey: existing.roleKey,
      label: existing.label,
      isSystemRole: existing.isSystemRole,
      permissions: existing.permissions,
    },
    ipAddress: input.ipAddress,
  });

  invalidateAuthzCache({ all: true });
  return { ok: true };
}

async function setRolePermissionsInternal(
  roleId: number,
  permissionKeys: string[],
  options: {
    actorUserId: number;
    ipAddress?: string | null;
    skipAuditBundle?: boolean;
    confirmImpact?: boolean;
  },
) {
  const uniqueKeys = [...new Set(permissionKeys.map((k) => String(k).trim()).filter(Boolean))];
  if (!uniqueKeys.length) {
    // Empty permissions — check admin lockout for super_admin
    const role = await getManagedRole(roleId);
    if (role?.roleKey === "super_admin") {
      fail(400, "super_admin cannot have all permissions removed");
    }
  }

  const placeholders = uniqueKeys.length ? uniqueKeys.map(() => "?").join(",") : null;
  const permRows = uniqueKeys.length
    ? await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
        `
        SELECT id, permission_key
        FROM ap_permissions
        WHERE is_active = 1 AND permission_key IN (${placeholders})
        `,
        uniqueKeys,
      )
    : [];

  if (permRows.length !== uniqueKeys.length) {
    const found = new Set(permRows.map((p) => String(p.permission_key)));
    const missing = uniqueKeys.filter((k) => !found.has(k));
    fail(400, `Unknown or inactive permission keys: ${missing.join(", ")}`);
  }

  const existing = await getManagedRole(roleId);
  if (!existing) fail(404, "Role not found");

  const nextHasManage = PORTAL_ADMIN_PERMISSION_KEYS.some((key) => uniqueKeys.includes(key));
  const prevHasManage = await roleHasPortalAdminPermission(roleId);

  if (prevHasManage && !nextHasManage) {
    const otherAdmins = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `
      SELECT COUNT(DISTINCT u.id) AS c
      FROM ap_users u
      INNER JOIN ap_user_roles ur ON ur.user_id = u.id
      INNER JOIN ap_roles r ON r.id = ur.role_id
      INNER JOIN ap_role_permissions rp ON rp.role_id = r.id
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE u.is_active = 1
        AND r.is_active = 1
        AND r.id <> ?
        AND ${portalAdminPermissionSql("p")}
        AND p.is_active = 1
      `,
      [roleId, ...PORTAL_ADMIN_PERMISSION_KEYS],
    );
    if (Number(otherAdmins[0]?.c ?? 0) === 0) {
      fail(
        400,
        "Cannot remove portal administration from the only role that grants it",
      );
    }
    if (!options.confirmImpact) {
      fail(
        400,
        "Removing portal administration from this role affects administrators. Pass confirmImpact=true to confirm.",
      );
    }
  }

  const before = existing.permissions;
  await executeAcademic(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [roleId]);
  for (const row of permRows) {
    await executeAcademic(
      `INSERT INTO ap_role_permissions (role_id, permission_id) VALUES (?, ?)`,
      [roleId, Number(row.id)],
    );
  }

  const added = uniqueKeys.filter((k) => !before.includes(k));
  const removed = before.filter((k) => !uniqueKeys.includes(k));

  if (!options.skipAuditBundle) {
    await writeAuditLog({
      actorUserId: options.actorUserId,
      action: "role.permissions.updated",
      entityType: "ap_role",
      entityId: roleId,
      oldValue: { permissions: before },
      newValue: { permissions: uniqueKeys, added, removed },
      ipAddress: options.ipAddress,
    });
    for (const key of added) {
      await writeAuditLog({
        actorUserId: options.actorUserId,
        action: "permission.assigned",
        entityType: "ap_role",
        entityId: roleId,
        newValue: { permissionKey: key },
        ipAddress: options.ipAddress,
      });
    }
    for (const key of removed) {
      await writeAuditLog({
        actorUserId: options.actorUserId,
        action: "permission.removed",
        entityType: "ap_role",
        entityId: roleId,
        oldValue: { permissionKey: key },
        ipAddress: options.ipAddress,
      });
    }
  }

  await revokeSessionsForRole(roleId);
}

export async function setRolePermissions(input: {
  roleId: number;
  permissionKeys: string[];
  actorUserId: number;
  ipAddress?: string | null;
  confirmImpact?: boolean;
}) {
  await setRolePermissionsInternal(input.roleId, input.permissionKeys, {
    actorUserId: input.actorUserId,
    ipAddress: input.ipAddress,
    confirmImpact: input.confirmImpact,
  });
  return getManagedRole(input.roleId);
}

/** Used by user-management for assignment validation against DB roles. */
export async function assertAssignableRole(roleKey: string) {
  const meta = await getRoleMetaByKey(roleKey);
  if (!meta) fail(400, `Unknown role: ${roleKey}`);
  if (!meta.isActive) fail(400, `Role is inactive: ${roleKey}`);
  return meta;
}
