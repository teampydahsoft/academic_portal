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

/** Canonical portal roles — only these five are active system roles. */
export const STANDARD_ROLE_KEYS = [
  "super_admin",
  "principal",
  "vice_principal",
  "hod",
  "staff",
] as const;

export type RoleKey = (typeof STANDARD_ROLE_KEYS)[number];

/** @deprecated Legacy role keys remapped by migrate-standard-roles.ts */
export const LEGACY_ROLE_KEY_MAP: Record<string, RoleKey> = {
  system_admin: "super_admin",
  faculty: "staff",
  management: "vice_principal",
  academic_admin: "vice_principal",
  exam_cell: "staff",
  auditor: "principal",
};

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

/**
 * Seed reference for roles that may use NULL/NULL global scope.
 * Runtime uses ap_roles.is_global_capable.
 */
export const GLOBAL_SCOPE_ROLES: RoleKey[] = ["super_admin"];

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
  super_admin: ALL,

  principal: [
    "dashboard.view",
    ...OPERATIONS_VIEW,
    "students.view",
    "faculty.view",
    "my_timetable.view",
    "timetable.view",
    "attendance.view",
    "attendance_analytics.view",
    "attendance.post",
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

  vice_principal: [
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

  /** Teaching staff — personal dashboard, own timetable, own attendance, requests, catalog metadata. */
  staff: [
    "dashboard.view",
    "my_timetable.view",
    "attendance.view",
    "attendance_analytics.view",
    "attendance.post",
    "catalog.view",
    "request.view",
    "request.create",
    ...MENTORING_MENTOR,
  ],
};

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = Object.fromEntries(
  (Object.entries(ROLE_PERMISSIONS_BASE) as [RoleKey, Permission[]][]).map(([roleKey, perms]) => [
    roleKey,
    roleKey === "super_admin" ? perms : expandModulePermissions(perms),
  ]),
) as Record<RoleKey, Permission[]>;

export function isKnownRoleKey(value: string): value is RoleKey {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value);
}

export function normalizeRoleKey(value: string): RoleKey | null {
  if (isKnownRoleKey(value)) return value;
  const mapped = LEGACY_ROLE_KEY_MAP[value];
  return mapped ?? null;
}

/** @deprecated Seed/compat only — runtime uses DB via authorization.service */
export function permissionsForRoleKeys(roleKeys: string[]): Permission[] {
  const set = new Set<Permission>();
  for (const key of roleKeys) {
    const normalized = normalizeRoleKey(key);
    if (!normalized) continue;
    for (const permission of ROLE_PERMISSIONS[normalized]) {
      set.add(permission);
    }
  }
  return [...set];
}
