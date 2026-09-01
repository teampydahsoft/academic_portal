/**
 * Permission catalog constants — seed / migration / type reference only.
 * Runtime authorization loads permissions from ap_permissions + ap_role_permissions.
 */

export const PERMISSIONS = [
  "dashboard.view",
  "pending_exceptions.view",
  "reports.view",
  "alerts.view",
  "students.view",
  "faculty.view",
  "my_timetable.view",
  "timetable.view",
  "timetable.edit",
  "timetable.publish",
  "attendance.view",
  "attendance_analytics.view",
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
  "roles.view",
  "roles.manage",
  "catalog.view",
  "semester_dates.view",
  "semester_dates.edit",
  "request.view",
  "request.create",
  "request.approve",
  "request.workflow.manage",
  "mentoring.view",
  "mentoring.manage",
  "mentoring.assign",
  "mentoring.intervene",
  "mentoring.case_manage",
  "mentoring.escalate",
] as const;

export type Permission = (typeof PERMISSIONS)[number] | (string & {});

/** When seeding roles, grant module-specific keys alongside legacy parent keys. */
export const MODULE_PERMISSION_EXPANSIONS: Partial<Record<Permission, Permission[]>> = {
  "user_management.view": ["roles.view"],
  "user_management.manage_users": ["roles.manage"],
};

export function expandModulePermissions(perms: Permission[]): Permission[] {
  const set = new Set<Permission>(perms);
  for (const permission of perms) {
    for (const child of MODULE_PERMISSION_EXPANSIONS[permission] ?? []) {
      set.add(child);
    }
  }
  return [...set];
}

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

const MENTORING_VIEW: Permission[] = ["mentoring.view"];
const MENTORING_FULL: Permission[] = [
  "mentoring.view",
  "mentoring.manage",
  "mentoring.assign",
  "mentoring.intervene",
  "mentoring.case_manage",
  "mentoring.escalate",
];
const MENTORING_MENTOR: Permission[] = ["mentoring.view", "mentoring.intervene"];

const OPERATIONS_VIEW: Permission[] = [
  "pending_exceptions.view",
  "reports.view",
  "alerts.view",
];

const VIEW_ACADEMIC: Permission[] = [
  "dashboard.view",
  ...OPERATIONS_VIEW,
  "students.view",
  "faculty.view",
  "my_timetable.view",
  "timetable.view",
  "attendance.view",
  "attendance_analytics.view",
  "attendance_calendar.view",
  "workload.view",
  "examinations.view",
  "results.view",
  "catalog.view",
  "semester_dates.view",
  "settings.view",
];

/** Seed reference matrix — must match migrated ap_role_permissions for system roles. */
const ROLE_PERMISSIONS_BASE: Record<RoleKey, Permission[]> = {
  system_admin: ALL,

  management: [...VIEW_ACADEMIC, "request.view", "request.create", "request.approve", "request.workflow.manage", ...MENTORING_FULL],

  academic_admin: [
    "dashboard.view",
    ...OPERATIONS_VIEW,
    "students.view",
    "faculty.view",
    "my_timetable.view",
    "timetable.view",
    "timetable.edit",
    "timetable.publish",
    "attendance.view",
    "attendance_analytics.view",
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
    "request.view",
    "request.create",
    "request.approve",
    "request.workflow.manage",
    ...MENTORING_FULL,
  ],

  principal: [
    "dashboard.view",
    ...OPERATIONS_VIEW,
    "students.view",
    "faculty.view",
    "my_timetable.view",
    "timetable.view",
    "attendance.view",
    "attendance_analytics.view",
    "attendance_calendar.view",
    "workload.view",
    "examinations.view",
    "results.view",
    "catalog.view",
    "semester_dates.view",
    "settings.view",
    "request.view",
    "request.create",
    "request.approve",
    ...MENTORING_FULL,
  ],

  hod: [
    "dashboard.view",
    ...OPERATIONS_VIEW,
    "students.view",
    "faculty.view",
    "my_timetable.view",
    "timetable.view",
    "timetable.edit",
    "attendance.view",
    "attendance_analytics.view",
    "attendance.post",
    "attendance_calendar.view",
    "workload.view",
    "catalog.view",
    "semester_dates.view",
    "request.view",
    "request.create",
    "request.approve",
    ...MENTORING_FULL,
  ],

  /** Teaching staff — personal dashboard, own timetable, own attendance, requests. */
  faculty: [
    "dashboard.view",
    "my_timetable.view",
    "attendance.view",
    "attendance.post",
    "request.view",
    "request.create",
    ...MENTORING_MENTOR,
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
    ...OPERATIONS_VIEW,
    "students.view",
    "faculty.view",
    "my_timetable.view",
    "timetable.view",
    "attendance.view",
    "attendance_analytics.view",
    "attendance_calendar.view",
    "workload.view",
    "examinations.view",
    "results.view",
    "catalog.view",
    "semester_dates.view",
    "settings.view",
    "request.view",
    ...MENTORING_VIEW,
  ],
};

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = Object.fromEntries(
  (Object.entries(ROLE_PERMISSIONS_BASE) as [RoleKey, Permission[]][]).map(([roleKey, perms]) => [
    roleKey,
    roleKey === "system_admin" ? perms : expandModulePermissions(perms),
  ]),
) as Record<RoleKey, Permission[]>;

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
