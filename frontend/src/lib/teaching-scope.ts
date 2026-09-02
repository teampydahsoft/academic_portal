import type { Authorization } from "@/components/auth/AuthProvider";

const INSTITUTE_WIDE_PERMISSIONS = [
  "timetable.edit",
  "timetable.publish",
  "user_management.manage_users",
  "settings.edit",
  "mentoring.manage",
] as const;

/** Roles that may search employees and raise requests on their behalf. */
const REQUEST_DELEGATE_ROLE_KEYS = new Set([
  "super_admin",
  "principal",
  "vice_principal",
  "hod",
]);

export function canRaiseRequestForOthers(authorization: Authorization | null): boolean {
  if (!authorization?.roles?.length) return false;
  return authorization.roles.some((role) => REQUEST_DELEGATE_ROLE_KEYS.has(role.roleKey));
}

/** Staff role only — must raise substitution for own classes. */
export function isStaffOnlyRequester(authorization: Authorization | null): boolean {
  if (!authorization?.roles?.length) return false;
  if (canRaiseRequestForOthers(authorization)) return false;
  return authorization.roles.some((role) => role.roleKey === "staff");
}

/** Global super admin — hide personal teaching/request routes from sidebar. */
export function isSuperAdminUser(authorization: Authorization | null): boolean {
  if (!authorization?.scope?.isGlobal) return false;
  return authorization.roles?.some((role) => role.roleKey === "super_admin") ?? false;
}

/** Faculty / teaching staff without institute-wide admin permissions. */
export function isTeachingStaffOnly(authorization: Authorization | null): boolean {
  if (!authorization?.permissions?.length) return false;
  const perms = authorization.permissions;
  const hasTeachingAccess =
    perms.includes("attendance.view") ||
    perms.includes("attendance.post") ||
    perms.includes("my_timetable.view");
  if (!hasTeachingAccess) return false;
  return !INSTITUTE_WIDE_PERMISSIONS.some((key) => perms.includes(key));
}

export function scopeAllowsCollege(
  authorization: Authorization | null,
  collegeId: number,
): boolean {
  if (!authorization?.scope) return true;
  if (authorization.scope.isGlobal) return true;
  const ids = authorization.scope.collegeIds;
  if (!ids?.length) return true;
  return ids.includes(collegeId);
}

export function scopeAllowsBranch(
  authorization: Authorization | null,
  branchId: number,
): boolean {
  if (!authorization?.scope) return true;
  if (authorization.scope.isGlobal) return true;
  const ids = authorization.scope.branchIds;
  if (!ids?.length) return true;
  return ids.includes(branchId);
}
