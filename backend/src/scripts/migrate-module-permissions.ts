/**
 * Incremental migration: add module-specific permission keys and grant them
 * to roles that already hold the legacy parent permission.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import {
  MODULE_PERMISSION_EXPANSIONS,
  PERMISSIONS,
  type Permission,
} from "../authz/permissions.js";

const PERMISSION_META: Record<
  Permission,
  { module: string; action: string; displayName: string; description: string }
> = {
  "dashboard.view": {
    module: "dashboard",
    action: "view",
    displayName: "View Dashboard",
    description: "Access Command Center / dashboard summary",
  },
  "pending_exceptions.view": {
    module: "pending_exceptions",
    action: "view",
    displayName: "View Pending & Exceptions",
    description: "View pending items and operational exceptions",
  },
  "reports.view": {
    module: "reports",
    action: "view",
    displayName: "View Reports",
    description: "Access operational reports hub",
  },
  "alerts.view": {
    module: "alerts",
    action: "view",
    displayName: "View Alerts",
    description: "Access operational alerts",
  },
  "students.view": {
    module: "students",
    action: "view",
    displayName: "View Students",
    description: "View student list and profiles",
  },
  "faculty.view": {
    module: "faculty",
    action: "view",
    displayName: "View Faculty",
    description: "View faculty and departments",
  },
  "my_timetable.view": {
    module: "my_timetable",
    action: "view",
    displayName: "View My Timetable",
    description: "View personal teaching timetable",
  },
  "timetable.view": {
    module: "timetable",
    action: "view",
    displayName: "View Timetable",
    description: "View timetables and timing templates",
  },
  "timetable.edit": {
    module: "timetable",
    action: "edit",
    displayName: "Edit Timetable",
    description: "Create and edit timetable drafts and timings",
  },
  "timetable.publish": {
    module: "timetable",
    action: "publish",
    displayName: "Publish Timetable",
    description: "Publish timetable plans",
  },
  "attendance.view": {
    module: "attendance",
    action: "view",
    displayName: "View Attendance",
    description: "View attendance sessions for posting",
  },
  "attendance_analytics.view": {
    module: "attendance_analytics",
    action: "view",
    displayName: "View Attendance Analytics",
    description: "View attendance analytics and trends",
  },
  "attendance.post": {
    module: "attendance",
    action: "post",
    displayName: "Post Attendance",
    description: "Post and edit class attendance",
  },
  "attendance_calendar.view": {
    module: "attendance_calendar",
    action: "view",
    displayName: "View Attendance Calendar",
    description: "View academic calendar and holidays",
  },
  "attendance_calendar.edit": {
    module: "attendance_calendar",
    action: "edit",
    displayName: "Edit Attendance Calendar",
    description: "Create and update institute holidays",
  },
  "workload.view": {
    module: "workload",
    action: "view",
    displayName: "View Workload",
    description: "View faculty workload",
  },
  "examinations.view": {
    module: "examinations",
    action: "view",
    displayName: "View Examinations",
    description: "View examinations and applications",
  },
  "results.view": {
    module: "results",
    action: "view",
    displayName: "View Results",
    description: "View examination results",
  },
  "settings.view": {
    module: "settings",
    action: "view",
    displayName: "View Settings",
    description: "View portal settings",
  },
  "settings.edit": {
    module: "settings",
    action: "edit",
    displayName: "Edit Settings",
    description: "Modify portal settings",
  },
  "user_management.view": {
    module: "user_management",
    action: "view",
    displayName: "View Users",
    description: "View Academic Portal users and assigned roles",
  },
  "user_management.manage_users": {
    module: "user_management",
    action: "manage_users",
    displayName: "Manage Users",
    description: "Link users, assign roles and college/branch scope, activate/deactivate users",
  },
  "roles.view": {
    module: "roles",
    action: "view",
    displayName: "View Roles & Permissions",
    description: "View role definitions and permission matrix",
  },
  "roles.manage": {
    module: "roles",
    action: "manage",
    displayName: "Manage Roles & Permissions",
    description: "Create, edit, and deactivate roles; assign permissions",
  },
  "catalog.view": {
    module: "catalog",
    action: "view",
    displayName: "View Catalog",
    description: "View academic masters / catalog",
  },
  "semester_dates.view": {
    module: "semester_dates",
    action: "view",
    displayName: "View Semester Dates",
    description: "View semester date windows",
  },
  "semester_dates.edit": {
    module: "semester_dates",
    action: "edit",
    displayName: "Edit Semester Dates",
    description: "Edit semester date configuration",
  },
  "request.view": {
    module: "request",
    action: "view",
    displayName: "View Requests",
    description: "View own requests and pending approvals",
  },
  "request.create": {
    module: "request",
    action: "create",
    displayName: "Create Requests",
    description: "Create and submit academic requests",
  },
  "request.approve": {
    module: "request",
    action: "approve",
    displayName: "Approve Requests",
    description: "Approve, reject, return, or escalate requests",
  },
  "request.workflow.manage": {
    module: "request",
    action: "manage_workflow",
    displayName: "Manage Request Workflows",
    description: "Configure request types and approval workflows",
  },
  "mentoring.view": {
    module: "mentoring",
    action: "view",
    displayName: "View Mentoring & Risks",
    description: "View mentoring dashboard, mentees, and complaints within academic scope",
  },
  "mentoring.manage": {
    module: "mentoring",
    action: "manage",
    displayName: "Manage Mentoring Scope",
    description: "View all students in scope for mentoring (not limited to own mentees)",
  },
  "mentoring.assign": {
    module: "mentoring",
    action: "assign",
    displayName: "Assign Mentors",
    description: "Assign, change, or remove mentor assignments",
  },
  "mentoring.intervene": {
    module: "mentoring",
    action: "intervene",
    displayName: "Record Interventions",
    description: "Add intervention records to complaints",
  },
  "mentoring.case_manage": {
    module: "mentoring",
    action: "case_manage",
    displayName: "Manage Complaints",
    description: "Create, monitor, and resolve student complaints",
  },
  "mentoring.escalate": {
    module: "mentoring",
    action: "escalate",
    displayName: "Escalate Complaints",
    description: "Escalate complaints for higher-level review",
  },
};

async function main() {
  console.log("=== Module-specific permissions migration ===\n");

  for (const key of PERMISSIONS) {
    const meta = PERMISSION_META[key];
    if (!meta) continue;
    await executeAcademic(
      `
      INSERT INTO ap_permissions
        (permission_key, module, action, display_name, description, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        module = VALUES(module),
        action = VALUES(action),
        display_name = VALUES(display_name),
        description = VALUES(description),
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      `,
      [key, meta.module, meta.action, meta.displayName, meta.description],
    );
  }
  console.log(`Upserted ${PERMISSIONS.length} permission catalog rows`);

  const permRows = await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
    `SELECT id, permission_key FROM ap_permissions WHERE is_active = 1`,
  );
  const permIdByKey = new Map(permRows.map((row) => [String(row.permission_key), Number(row.id)]));

  const roles = await queryAcademic<(RowDataPacket & { id: number; role_key: string })[]>(
    `SELECT id, role_key FROM ap_roles`,
  );

  let grantsAdded = 0;
  for (const role of roles) {
    const roleId = Number(role.id);
    const held = await queryAcademic<(RowDataPacket & { permission_key: string })[]>(
      `
      SELECT p.permission_key
      FROM ap_role_permissions rp
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.is_active = 1
      `,
      [roleId],
    );
    const heldKeys = new Set(held.map((row) => String(row.permission_key)));

    for (const [parentKey, children] of Object.entries(MODULE_PERMISSION_EXPANSIONS)) {
      if (!heldKeys.has(parentKey)) continue;
      for (const childKey of children ?? []) {
        if (heldKeys.has(childKey)) continue;
        const permissionId = permIdByKey.get(childKey);
        if (!permissionId) {
          throw new Error(`Missing permission row for ${childKey}`);
        }
        await executeAcademic(
          `INSERT IGNORE INTO ap_role_permissions (role_id, permission_id) VALUES (?, ?)`,
          [roleId, permissionId],
        );
        grantsAdded += 1;
        heldKeys.add(childKey);
        console.log(`  ${role.role_key}: granted ${childKey} (from ${parentKey})`);
      }
    }
  }

  console.log(`\nMigration OK. Added ${grantsAdded} module-specific grants.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
