/**
 * Permission catalog constants — seed / migration / type reference only.
 * Runtime authorization loads permissions from ap_permissions + ap_role_permissions.
 */

export const PERMISSIONS = [
  "dashboard.view",
  "students.view",
  "faculty.view",
  "timetable.view",
  "timetable.edit",
  "timetable.publish",
  "attendance.view",
  "attendance.post",
  "attendance_calendar.view",
  "attendance_calendar.edit",
  "workload.view",
  "examinations.view",
  "results.view",
  "settings.view",
  "settings.edit",
  "user_management.view",
  "user_management.manage_users",
  "catalog.view",
  "semester_dates.view",
  "semester_dates.edit",
] as const;

export type Permission = (typeof PERMISSIONS)[number] | (string & {});

export type RoleKey =
  | "system_admin"
  | "management"
  | "principal"
  | "academic_admin"
  | "hod"
  | "faculty"
  | "exam_cell"
  | "auditor";

/**
 * Seed reference for roles that may use NULL/NULL global scope.
 * Runtime uses ap_roles.is_global_capable.
 */
export const GLOBAL_SCOPE_ROLES: RoleKey[] = [
  "system_admin",
  "management",
  "academic_admin",
  "auditor",
];

const ALL: Permission[] = [...PERMISSIONS];

const VIEW_ACADEMIC: Permission[] = [
  "dashboard.view",
  "students.view",
  "faculty.view",
  "timetable.view",
  "attendance.view",
  "attendance_calendar.view",
  "workload.view",
  "examinations.view",
  "results.view",
  "catalog.view",
  "semester_dates.view",
  "settings.view",
];

/** Seed reference matrix — must match migrated ap_role_permissions for system roles. */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  system_admin: ALL,

  management: VIEW_ACADEMIC,

  academic_admin: [
    "dashboard.view",
    "students.view",
    "faculty.view",
    "timetable.view",
    "timetable.edit",
    "timetable.publish",
    "attendance.view",
    "attendance.post",
    "attendance_calendar.view",
    "attendance_calendar.edit",
    "workload.view",
    "examinations.view",
    "results.view",
    "catalog.view",
    "semester_dates.view",
    "semester_dates.edit",
    "settings.view",
    "settings.edit",
  ],

  principal: [
    "dashboard.view",
    "students.view",
    "faculty.view",
    "timetable.view",
    "attendance.view",
    "attendance_calendar.view",
    "workload.view",
    "examinations.view",
    "results.view",
    "catalog.view",
    "semester_dates.view",
    "settings.view",
  ],

  hod: [
    "dashboard.view",
    "students.view",
    "faculty.view",
    "timetable.view",
    "timetable.edit",
    "attendance.view",
    "attendance.post",
    "attendance_calendar.view",
    "workload.view",
    "catalog.view",
    "semester_dates.view",
  ],

  faculty: [
    "dashboard.view",
    "students.view",
    "faculty.view",
    "timetable.view",
    "attendance.view",
    "attendance.post",
    "workload.view",
    "catalog.view",
  ],

  exam_cell: [
    "dashboard.view",
    "students.view",
    "examinations.view",
    "results.view",
    "catalog.view",
  ],

  auditor: [
    "dashboard.view",
    "students.view",
    "faculty.view",
    "timetable.view",
    "attendance.view",
    "attendance_calendar.view",
    "workload.view",
    "examinations.view",
    "results.view",
    "catalog.view",
    "semester_dates.view",
    "settings.view",
  ],
};

export function isKnownRoleKey(value: string): value is RoleKey {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value);
}

/** @deprecated Seed/compat only — runtime uses DB via authorization.service */
export function permissionsForRoleKeys(roleKeys: string[]): Permission[] {
  const set = new Set<Permission>();
  for (const key of roleKeys) {
    if (!isKnownRoleKey(key)) continue;
    for (const permission of ROLE_PERMISSIONS[key]) {
      set.add(permission);
    }
  }
  return [...set];
}
