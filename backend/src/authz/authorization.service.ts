import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";
import type { Permission, RoleKey } from "./permissions.js";
import { GLOBAL_SCOPE_ROLES, isKnownRoleKey } from "./permissions.js";

export type RoleAssignment = {
  roleKey: string;
  label: string;
  collegeId: number | null;
  branchId: number | null;
  roleId?: number;
  isGlobalCapable?: boolean;
  isActive?: boolean;
};

export type AcademicScope = {
  /** True when a global-capable role is assigned with NULL college and NULL branch. */
  isGlobal: boolean;
  /** null = all colleges (global). Empty array = no college access. */
  collegeIds: number[] | null;
  /** null = all branches (within allowed colleges). Empty array = no branch access when branch-restricted. */
  branchIds: number[] | null;
};

export type AuthzContext = {
  userId: number;
  roles: RoleAssignment[];
  roleKeys: string[];
  permissions: Permission[];
  scope: AcademicScope;
};

type RoleRow = RowDataPacket & {
  role_id: number;
  role_key: string;
  label: string;
  college_id: number | null;
  branch_id: number | null;
  is_global_capable: number;
  is_active: number;
};

type PermRow = RowDataPacket & {
  permission_key: string;
};

type RoleMetaRow = RowDataPacket & {
  id: number;
  role_key: string;
  is_global_capable: number;
  is_active: number;
  is_system_role: number;
};

const AUTH_CACHE_TTL_MS = 15_000;
const rolePermCache = new Map<number, { expiresAt: number; permissions: string[] }>();
const roleMetaCache = new Map<string, { expiresAt: number; meta: RoleMetaRow | null }>();

export function invalidateAuthzCache(options?: {
  userId?: number;
  roleId?: number;
  all?: boolean;
}) {
  if (options?.all || (!options?.userId && options?.roleId == null)) {
    rolePermCache.clear();
    roleMetaCache.clear();
    return;
  }
  if (options.roleId != null) {
    rolePermCache.delete(options.roleId);
    roleMetaCache.clear();
  }
  // userId-only: role→permission cache remains valid; assignments are always loaded fresh
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)))];
}

export function buildScopeFromAssignments(assignments: RoleAssignment[]): AcademicScope {
  let isGlobal = false;
  const collegeIds: number[] = [];
  const branchIds: number[] = [];
  let hasBranchRestriction = false;

  for (const assignment of assignments) {
    const collegeId = assignment.collegeId;
    const branchId = assignment.branchId;
    const globalCapable =
      assignment.isGlobalCapable ??
      (isKnownRoleKey(assignment.roleKey) &&
        GLOBAL_SCOPE_ROLES.includes(assignment.roleKey as RoleKey));

    if (collegeId == null && branchId == null && globalCapable && assignment.isActive !== false) {
      isGlobal = true;
      continue;
    }

    if (collegeId != null) collegeIds.push(collegeId);
    if (branchId != null) {
      branchIds.push(branchId);
      hasBranchRestriction = true;
    }
  }

  if (isGlobal) {
    return { isGlobal: true, collegeIds: null, branchIds: null };
  }

  return {
    isGlobal: false,
    collegeIds: uniqueNumbers(collegeIds),
    branchIds: hasBranchRestriction ? uniqueNumbers(branchIds) : null,
  };
}

async function loadPermissionsForRoleIds(roleIds: number[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const now = Date.now();
  const missing: number[] = [];
  const collected = new Set<string>();

  for (const roleId of roleIds) {
    const cached = rolePermCache.get(roleId);
    if (cached && cached.expiresAt > now) {
      for (const p of cached.permissions) collected.add(p);
    } else {
      missing.push(roleId);
    }
  }

  if (missing.length) {
    const placeholders = missing.map(() => "?").join(",");
    const rows = await queryAcademic<(PermRow & { role_id: number })[]>(
      `
      SELECT rp.role_id, p.permission_key
      FROM ap_role_permissions rp
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      INNER JOIN ap_roles r ON r.id = rp.role_id
      WHERE rp.role_id IN (${placeholders})
        AND p.is_active = 1
        AND r.is_active = 1
      `,
      missing,
    );

    const byRole = new Map<number, string[]>();
    for (const id of missing) byRole.set(id, []);
    for (const row of rows) {
      const list = byRole.get(Number(row.role_id)) ?? [];
      list.push(String(row.permission_key));
      byRole.set(Number(row.role_id), list);
    }
    for (const [roleId, permissions] of byRole) {
      rolePermCache.set(roleId, {
        expiresAt: now + AUTH_CACHE_TTL_MS,
        permissions,
      });
      for (const p of permissions) collected.add(p);
    }
  }

  return [...collected].sort();
}

export async function getRoleMetaByKey(roleKey: string): Promise<{
  id: number;
  roleKey: string;
  isGlobalCapable: boolean;
  isActive: boolean;
  isSystemRole: boolean;
} | null> {
  const now = Date.now();
  const cached = roleMetaCache.get(roleKey);
  if (cached && cached.expiresAt > now) {
    if (!cached.meta) return null;
    return {
      id: Number(cached.meta.id),
      roleKey: String(cached.meta.role_key),
      isGlobalCapable: Number(cached.meta.is_global_capable) === 1,
      isActive: Number(cached.meta.is_active) === 1,
      isSystemRole: Number(cached.meta.is_system_role) === 1,
    };
  }

  const rows = await queryAcademic<RoleMetaRow[]>(
    `
    SELECT id, role_key, is_global_capable, is_active, is_system_role
    FROM ap_roles
    WHERE role_key = ?
    LIMIT 1
    `,
    [roleKey],
  );
  const meta = rows[0] ?? null;
  roleMetaCache.set(roleKey, { expiresAt: now + AUTH_CACHE_TTL_MS, meta });
  if (!meta) return null;
  return {
    id: Number(meta.id),
    roleKey: String(meta.role_key),
    isGlobalCapable: Number(meta.is_global_capable) === 1,
    isActive: Number(meta.is_active) === 1,
    isSystemRole: Number(meta.is_system_role) === 1,
  };
}

export async function loadAuthzContext(userId: number): Promise<AuthzContext> {
  const rows = await queryAcademic<RoleRow[]>(
    `
    SELECT
      r.id AS role_id,
      r.role_key,
      r.label,
      r.is_global_capable,
      r.is_active,
      ur.college_id,
      ur.branch_id
    FROM ap_user_roles ur
    INNER JOIN ap_roles r ON r.id = ur.role_id
    WHERE ur.user_id = ?
    ORDER BY r.role_key, ur.id
    `,
    [userId],
  );

  const roles: RoleAssignment[] = rows
    .filter((row) => Number(row.is_active) === 1)
    .map((row) => ({
      roleId: Number(row.role_id),
      roleKey: String(row.role_key),
      label: String(row.label),
      collegeId: row.college_id == null ? null : Number(row.college_id),
      branchId: row.branch_id == null ? null : Number(row.branch_id),
      isGlobalCapable: Number(row.is_global_capable) === 1,
      isActive: Number(row.is_active) === 1,
    }));

  const roleKeys = [...new Set(roles.map((r) => r.roleKey))];
  const roleIds = [...new Set(roles.map((r) => r.roleId!).filter(Boolean))];
  const permissions = (await loadPermissionsForRoleIds(roleIds)) as Permission[];
  const scope = buildScopeFromAssignments(roles);

  return {
    userId,
    roles,
    roleKeys,
    permissions,
    scope,
  };
}

export function hasPermission(
  authz: AuthzContext | null | undefined,
  permission: Permission | string,
): boolean {
  if (!authz) return false;
  return authz.permissions.includes(permission as Permission);
}

export function hasAnyPermission(
  authz: AuthzContext | null | undefined,
  permissions: Array<Permission | string>,
): boolean {
  if (!authz) return false;
  return permissions.some((p) => authz.permissions.includes(p as Permission));
}

export type ScopeFilters = {
  collegeId?: number;
  branchId?: number;
};

/**
 * Validate requested academic filters against the user's scope.
 * Returns filters that must be applied to queries.
 * Throws { status: 403 } when the request is out of scope.
 */
export function enforceAcademicScope(
  authz: AuthzContext,
  requested: ScopeFilters = {},
): { collegeId?: number; collegeIds?: number[]; branchId?: number; branchIds?: number[] } {
  const { scope } = authz;

  if (scope.isGlobal) {
    return {
      collegeId: requested.collegeId,
      branchId: requested.branchId,
    };
  }

  const allowedColleges = scope.collegeIds ?? [];
  if (!allowedColleges.length) {
    throw Object.assign(new Error("No academic scope assigned"), { status: 403 });
  }

  if (requested.collegeId != null && !allowedColleges.includes(requested.collegeId)) {
    throw Object.assign(new Error("Forbidden for this college scope"), { status: 403 });
  }

  const collegeId =
    requested.collegeId ?? (allowedColleges.length === 1 ? allowedColleges[0] : undefined);
  const collegeIds = collegeId == null ? allowedColleges : undefined;

  if (scope.branchIds != null) {
    if (!scope.branchIds.length) {
      throw Object.assign(new Error("No branch scope assigned"), { status: 403 });
    }
    if (requested.branchId != null && !scope.branchIds.includes(requested.branchId)) {
      throw Object.assign(new Error("Forbidden for this branch scope"), { status: 403 });
    }
    const branchId =
      requested.branchId ?? (scope.branchIds.length === 1 ? scope.branchIds[0] : undefined);
    return {
      collegeId,
      collegeIds,
      branchId,
      branchIds: branchId == null ? scope.branchIds : undefined,
    };
  }

  return {
    collegeId,
    collegeIds,
    branchId: requested.branchId,
  };
}

export function assertEntityInScope(
  authz: AuthzContext,
  entity: { collegeId?: number | null; branchId?: number | null },
) {
  const { scope } = authz;
  if (scope.isGlobal) return;

  const allowedColleges = scope.collegeIds ?? [];
  if (!allowedColleges.length) {
    throw Object.assign(new Error("No academic scope assigned"), { status: 403 });
  }

  if (entity.collegeId == null || !allowedColleges.includes(Number(entity.collegeId))) {
    throw Object.assign(new Error("Forbidden for this college scope"), { status: 403 });
  }

  if (scope.branchIds != null) {
    if (entity.branchId == null || !scope.branchIds.includes(Number(entity.branchId))) {
      throw Object.assign(new Error("Forbidden for this branch scope"), { status: 403 });
    }
  }
}

export function isRoleKey(value: string): value is RoleKey {
  return isKnownRoleKey(value);
}

/** List user IDs that currently hold a given role (for session revocation). */
export async function listUserIdsWithRole(roleId: number): Promise<number[]> {
  const rows = await queryAcademic<(RowDataPacket & { user_id: number })[]>(
    `SELECT DISTINCT user_id FROM ap_user_roles WHERE role_id = ?`,
    [roleId],
  );
  return rows.map((r) => Number(r.user_id));
}
