/**
 * UI presentation catalog for Roles & Permissions.
 * Maps existing backend permission keys onto the live sidebar (NAV_GROUPS).
 * Does not invent keys or change authorization behavior.
 */

export type PermissionAccessKind = "read" | "write";

export type MatrixPermissionDef = {
  key: string;
  label: string;
  description: string;
  kind: PermissionAccessKind;
  /** Highlight high-impact actions in the UI only. */
  sensitive?: boolean;
};

export type MatrixModuleDef = {
  /** Sidebar group title from navigation.ts */
  group: string;
  /** Sidebar item label from navigation.ts */
  label: string;
  href: string;
  permissions: MatrixPermissionDef[];
  /**
   * When this nav item is unlocked by a permission owned primarily elsewhere,
   * explain the relationship (still lists the key so admins see coverage).
   */
  accessNote?: string;
};

/** Human labels / descriptions for every existing catalog key. */
export const PERMISSION_PRESENTATION: Record<
  string,
  Omit<MatrixPermissionDef, "kind" | "sensitive"> & {
    kind: PermissionAccessKind;
    sensitive?: boolean;
  }
> = {
  "dashboard.view": {
    key: "dashboard.view",
    label: "View Dashboard",
    description: "Opens the dashboard overview for your access scope.",
    kind: "read",
  },
  "pending_exceptions.view": {
    key: "pending_exceptions.view",
    label: "View Pending & Exceptions",
    description: "View pending items and operational exceptions.",
    kind: "read",
  },
  "reports.view": {
    key: "reports.view",
    label: "View Reports",
    description: "Access the operational reports hub.",
    kind: "read",
  },
  "alerts.view": {
    key: "alerts.view",
    label: "View Alerts",
    description: "Access operational alerts.",
    kind: "read",
  },
  "students.view": {
    key: "students.view",
    label: "View Students",
    description: "View student list and profiles. Also unlocks Mentoring & Risks in the sidebar.",
    kind: "read",
  },
  "faculty.view": {
    key: "faculty.view",
    label: "View Faculty & Departments",
    description: "View faculty directory and department listings from HRMS-linked staff.",
    kind: "read",
  },
  "timetable.view": {
    key: "timetable.view",
    label: "View Timetable Planning",
    description: "View timetable plans, published schedules, and timing templates.",
    kind: "read",
  },
  "my_timetable.view": {
    key: "my_timetable.view",
    label: "View My Timetable",
    description: "View personal teaching timetable.",
    kind: "read",
  },
  "timetable.edit": {
    key: "timetable.edit",
    label: "Create / Edit Draft & Configure Timings",
    description:
      "Create and edit timetable drafts, run review, copy plans, and configure college timing templates.",
    kind: "write",
  },
  "timetable.publish": {
    key: "timetable.publish",
    label: "Publish Timetable",
    description: "Publish an approved timetable so it becomes live for attendance and workload.",
    kind: "write",
    sensitive: true,
  },
  "attendance.view": {
    key: "attendance.view",
    label: "View Attendance Posting",
    description: "View attendance sessions and posting screens.",
    kind: "read",
  },
  "attendance_analytics.view": {
    key: "attendance_analytics.view",
    label: "View Attendance Analytics",
    description: "View attendance analytics and trends.",
    kind: "read",
  },
  "attendance.post": {
    key: "attendance.post",
    label: "Post / Edit Attendance",
    description: "Mark and submit class attendance. Editing an already-posted session also requires this action.",
    kind: "write",
    sensitive: true,
  },
  "attendance_calendar.view": {
    key: "attendance_calendar.view",
    label: "View Attendance Calendar",
    description: "View the institute attendance calendar and declared holidays.",
    kind: "read",
  },
  "attendance_calendar.edit": {
    key: "attendance_calendar.edit",
    label: "Edit Holidays / Calendar",
    description: "Create and update institute holidays on the attendance calendar.",
    kind: "write",
    sensitive: true,
  },
  "workload.view": {
    key: "workload.view",
    label: "View Staff Workload",
    description: "View faculty workload summaries and period loads.",
    kind: "read",
  },
  "examinations.view": {
    key: "examinations.view",
    label: "View Examinations",
    description: "View examinations, subjects, scopes, and applications from EMS.",
    kind: "read",
  },
  "results.view": {
    key: "results.view",
    label: "View Results",
    description: "View examination results by exam or student roll number.",
    kind: "read",
  },
  "catalog.view": {
    key: "catalog.view",
    label: "View Curriculum & Subjects",
    description: "View academic masters, subjects, and curriculum catalog data.",
    kind: "read",
  },
  "settings.view": {
    key: "settings.view",
    label: "View Settings",
    description: "Open Settings and view configuration panels (excluding restricted edits).",
    kind: "read",
  },
  "settings.edit": {
    key: "settings.edit",
    label: "Edit Settings",
    description: "Change portal settings such as Faculty & Departments display groups.",
    kind: "write",
    sensitive: true,
  },
  "semester_dates.view": {
    key: "semester_dates.view",
    label: "View Semester Dates",
    description: "View academic semester start and end dates under Settings.",
    kind: "read",
  },
  "semester_dates.edit": {
    key: "semester_dates.edit",
    label: "Edit Semester Dates",
    description: "Update academic semester date windows under Settings.",
    kind: "write",
    sensitive: true,
  },
  "user_management.view": {
    key: "user_management.view",
    label: "View Users",
    description: "View Academic Portal users, assigned roles, and permission summaries.",
    kind: "read",
  },
  "user_management.manage_users": {
    key: "user_management.manage_users",
    label: "Manage Users",
    description:
      "Link HRMS users, assign roles and college/branch scope, and activate/deactivate users.",
    kind: "write",
    sensitive: true,
  },
  "roles.view": {
    key: "roles.view",
    label: "View Roles & Permissions",
    description: "View role definitions and the permission matrix.",
    kind: "read",
  },
  "roles.manage": {
    key: "roles.manage",
    label: "Manage Roles & Permissions",
    description: "Create, edit, and deactivate roles; assign permissions to roles.",
    kind: "write",
    sensitive: true,
  },
  "request.view": {
    key: "request.view",
    label: "View Requests",
    description: "View own requests and pending approvals.",
    kind: "read",
  },
  "request.create": {
    key: "request.create",
    label: "Create Requests",
    description: "Create and submit academic requests.",
    kind: "write",
  },
  "request.approve": {
    key: "request.approve",
    label: "Approve Requests",
    description: "Approve, reject, return, or escalate requests.",
    kind: "write",
    sensitive: true,
  },
  "request.workflow.manage": {
    key: "request.workflow.manage",
    label: "Manage Request Workflows",
    description: "Configure request types and approval workflows.",
    kind: "write",
    sensitive: true,
  },
  "mentoring.view": {
    key: "mentoring.view",
    label: "View Mentoring & Risks",
    description: "View mentoring dashboard, mentees, and complaints within academic scope.",
    kind: "read",
  },
  "mentoring.manage": {
    key: "mentoring.manage",
    label: "Manage Mentoring Scope",
    description: "View all students in scope for mentoring (not limited to own mentees).",
    kind: "read",
  },
  "mentoring.assign": {
    key: "mentoring.assign",
    label: "Assign Mentors",
    description: "Assign, change, or remove mentor assignments.",
    kind: "write",
  },
  "mentoring.intervene": {
    key: "mentoring.intervene",
    label: "Record Interventions",
    description: "Add intervention records to complaints.",
    kind: "write",
  },
  "mentoring.case_manage": {
    key: "mentoring.case_manage",
    label: "Manage Complaints",
    description: "Create, monitor, and resolve student complaints.",
    kind: "write",
    sensitive: true,
  },
  "mentoring.escalate": {
    key: "mentoring.escalate",
    label: "Escalate Complaints",
    description: "Escalate complaints for higher-level review.",
    kind: "write",
    sensitive: true,
  },
};

/**
 * Sidebar-ordered matrix. Mirrors NAV_GROUPS labels/hrefs.
 * Each module uses its own permission keys so access can be granted independently.
 */
export const PERMISSION_MATRIX_MODULES: MatrixModuleDef[] = [
  {
    group: "Overview",
    label: "Dashboard",
    href: "/dashboard",
    permissions: [asDef("dashboard.view")],
  },
  {
    group: "Academics",
    label: "Students",
    href: "/students",
    permissions: [asDef("students.view")],
  },
  {
    group: "Academics",
    label: "My Timetable",
    href: "/my-timetable",
    permissions: [asDef("my_timetable.view")],
  },
  {
    group: "Academics",
    label: "Attendance Calendar",
    href: "/attendance-calendar",
    permissions: [asDef("attendance_calendar.view"), asDef("attendance_calendar.edit")],
  },
  {
    group: "Academics",
    label: "Timetables",
    href: "/timetables",
    permissions: [asDef("timetable.view"), asDef("timetable.edit"), asDef("timetable.publish")],
  },
  {
    group: "Academics",
    label: "Staff Workload",
    href: "/staff-workload",
    permissions: [asDef("workload.view")],
  },
  {
    group: "Academics",
    label: "Attendance Posting",
    href: "/attendance-posting",
    permissions: [asDef("attendance.view"), asDef("attendance.post")],
  },
  {
    group: "Academics",
    label: "Attendance Analytics",
    href: "/attendance-analytics",
    permissions: [asDef("attendance_analytics.view")],
  },
  {
    group: "Academics",
    label: "Faculty & Departments",
    href: "/faculty-departments",
    permissions: [asDef("faculty.view")],
  },
  {
    group: "Academics",
    label: "Curriculum & Subjects",
    href: "/curriculum-subjects",
    permissions: [asDef("catalog.view")],
  },
  {
    group: "Examinations",
    label: "Examinations",
    href: "/examinations",
    permissions: [asDef("examinations.view")],
  },
  {
    group: "Examinations",
    label: "Results",
    href: "/results",
    permissions: [asDef("results.view")],
  },
  {
    group: "Student Support",
    label: "Mentoring & Risks",
    href: "/mentoring-risks",
    permissions: [
      asDef("mentoring.view"),
      asDef("mentoring.manage"),
      asDef("mentoring.assign"),
      asDef("mentoring.intervene"),
      asDef("mentoring.case_manage"),
      asDef("mentoring.escalate"),
    ],
    accessNote: "mentoring.view unlocks the page. students.view remains supported for legacy access during RBAC rollout.",
  },
  {
    group: "Operations",
    label: "Pending & Exceptions",
    href: "/pending-exceptions",
    permissions: [asDef("pending_exceptions.view")],
  },
  {
    group: "Operations",
    label: "Reports",
    href: "/reports",
    permissions: [asDef("reports.view")],
  },
  {
    group: "Operations",
    label: "Requests",
    href: "/requests",
    permissions: [asDef("request.view"), asDef("request.create"), asDef("request.approve")],
  },
  {
    group: "Operations",
    label: "Alerts",
    href: "/alerts",
    permissions: [asDef("alerts.view")],
  },
  {
    group: "System",
    label: "User Management",
    href: "/user-management",
    permissions: [asDef("user_management.view"), asDef("user_management.manage_users")],
  },
  {
    group: "System",
    label: "Roles & Permissions",
    href: "/settings/roles",
    permissions: [asDef("roles.view"), asDef("roles.manage")],
  },
  {
    group: "System",
    label: "Settings",
    href: "/settings",
    permissions: [
      asDef("settings.view"),
      asDef("settings.edit"),
      asDef("semester_dates.view"),
      asDef("semester_dates.edit"),
    ],
  },
];

function asDef(key: string): MatrixPermissionDef {
  const meta = PERMISSION_PRESENTATION[key];
  if (!meta) {
    return {
      key,
      label: key,
      description: "Application permission",
      kind: key.endsWith(".view") ? "read" : "write",
    };
  }
  return {
    key: meta.key,
    label: meta.label,
    description: meta.description,
    kind: meta.kind,
    sensitive: meta.sensitive,
  };
}

/** Every known catalog key that must appear somewhere in the matrix. */
export function allMatrixPermissionKeys(): string[] {
  return Object.keys(PERMISSION_PRESENTATION);
}

export function summarizeRoleAccess(enabledKeys: Set<string> | string[]) {
  const enabled = enabledKeys instanceof Set ? enabledKeys : new Set(enabledKeys);
  let modulesWithAccess = 0;
  let read = 0;
  let write = 0;
  const counted = new Set<string>();

  for (const mod of PERMISSION_MATRIX_MODULES) {
    const keys = mod.permissions.map((p) => p.key);
    if (keys.some((k) => enabled.has(k))) modulesWithAccess += 1;
  }

  for (const meta of Object.values(PERMISSION_PRESENTATION)) {
    if (!enabled.has(meta.key) || counted.has(meta.key)) continue;
    counted.add(meta.key);
    if (meta.kind === "read") read += 1;
    else write += 1;
  }

  return { modulesWithAccess, read, write };
}

export function moduleAccessState(
  mod: MatrixModuleDef,
  enabled: Set<string>,
): "none" | "view" | "manage" | "partial" {
  const reads = mod.permissions.filter((p) => p.kind === "read").map((p) => p.key);
  const writes = mod.permissions.filter((p) => p.kind === "write").map((p) => p.key);
  const allReads = reads.length === 0 || reads.every((k) => enabled.has(k));
  const anyRead = reads.some((k) => enabled.has(k));
  const allWrites = writes.length > 0 && writes.every((k) => enabled.has(k));
  const anyWrite = writes.some((k) => enabled.has(k));
  const any = anyRead || anyWrite;

  if (!any) return "none";
  if (writes.length === 0) {
    return allReads ? "view" : "partial";
  }
  if (allReads && allWrites) return "manage";
  if (allReads && !anyWrite) return "view";
  return "partial";
}
