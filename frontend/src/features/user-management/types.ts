export type RoleAssignment = {
  id: number;
  roleId: number;
  roleKey: string;
  label: string;
  collegeId: number | null;
  collegeName: string | null;
  branchId: number | null;
  branchName: string | null;
  createdAt: string | null;
};

export type ManagedUser = {
  id: number;
  name: string;
  email: string | null;
  username: string;
  hrmsEmployeeId: string | null;
  isActive: boolean;
  isLocalBootstrap: boolean;
  roles: RoleAssignment[];
  lastLoginAt: string | null;
  permissions?: string[];
  rolePermissions?: string[];
  directPermissions?: string[];
  revokedPermissions?: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ApRoleOption = {
  id: number;
  roleKey: string;
  label: string;
  description: string | null;
  isGlobalCapable: boolean;
  isSystemRole?: boolean;
  isActive?: boolean;
  permissions: string[];
};

export type ManagedRole = {
  id: number;
  roleKey: string;
  label: string;
  description: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  isGlobalCapable: boolean;
  assignmentCount: number;
  activeUserCount?: number;
  permissions: string[];
  permissionIds: number[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type PermissionCatalogItem = {
  id: number;
  permissionKey: string;
  module: string;
  action: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
};

export type HrmsCandidate = {
  hrmsUserId: string;
  name: string;
  email: string | null;
  employeeId: string | null;
  department?: string | null;
  designation?: string | null;
  isActive: boolean;
  alreadyLinked: boolean;
  canLink: boolean;
  linkBlockReason?: string | null;
  /** True when a matching HRMS login exists (password source for portal sign-in). */
  hasHrmsLogin?: boolean;
};

export function formatScope(role: RoleAssignment) {
  if (role.collegeId == null && role.branchId == null) return "Global";
  const college = role.collegeName ?? (role.collegeId != null ? `#${role.collegeId}` : "—");
  if (role.branchId == null) return `${college} / All branches`;
  const branch = role.branchName ?? `#${role.branchId}`;
  return `${college} / ${branch}`;
}

export function formatLastLogin(value: string | null) {
  if (!value) return "Never";
  const raw = value.trim();
  // API should send UTC ISO with Z; also accept naive MySQL DATETIME as UTC.
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const normalized = hasZone ? raw : `${raw.includes("T") ? raw : raw.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Local bootstrap account seeded with system_admin — role/scope must stay fixed. */
export function isBootstrapSuperAdmin(
  user: Pick<ManagedUser, "isLocalBootstrap" | "roles">,
): boolean {
  return user.isLocalBootstrap && user.roles.some((r) => r.roleKey === "system_admin");
}
