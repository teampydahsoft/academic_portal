import type { Authorization } from "@/components/auth/AuthProvider";

const INSTITUTE_WIDE_PERMISSIONS = [
  "timetable.edit",
  "timetable.publish",
  "user_management.manage_users",
  "settings.edit",
  "mentoring.manage",
] as const;

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
