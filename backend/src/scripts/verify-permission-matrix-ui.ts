/**
 * Read-only check: permission matrix covers catalog keys; no key inventing.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";
import { PERMISSIONS, ROLE_PERMISSIONS, type RoleKey } from "../authz/permissions.js";

/** Mirror of frontend matrix keys — keep in sync with permission-matrix.ts */
const MATRIX_KEYS = [
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
  "settings.view",
  "settings.edit",
  "semester_dates.view",
  "semester_dates.edit",
  "user_management.view",
  "user_management.manage_users",
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("=== Permission matrix compatibility ===\n");

  const code = [...PERMISSIONS].sort();
  const matrix = [...MATRIX_KEYS].sort();
  assert(code.length === matrix.length, `count mismatch code=${code.length} matrix=${matrix.length}`);
  for (let i = 0; i < code.length; i++) {
    assert(code[i] === matrix[i], `key mismatch at ${i}: ${code[i]} vs ${matrix[i]}`);
  }
  console.log("1. Every catalog permission appears in the sidebar matrix (exact set)");

  const db = await queryAcademic<(RowDataPacket & { permission_key: string })[]>(
    `SELECT permission_key FROM ap_permissions WHERE is_active = 1 ORDER BY permission_key`,
  );
  const dbKeys = db.map((r) => String(r.permission_key)).sort();
  assert(dbKeys.length === matrix.length, "DB catalog size mismatch");
  for (let i = 0; i < dbKeys.length; i++) {
    assert(dbKeys[i] === matrix[i], `DB key mismatch ${dbKeys[i]} vs ${matrix[i]}`);
  }
  console.log("2. Live ap_permissions matches matrix keys");

  for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    const rows = await queryAcademic<(RowDataPacket & { permission_key: string })[]>(
      `
      SELECT p.permission_key
      FROM ap_roles r
      INNER JOIN ap_role_permissions rp ON rp.role_id = r.id
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE r.role_key = ? AND p.is_active = 1
      ORDER BY p.permission_key
      `,
      [roleKey],
    );
    const fromDb = rows.map((r) => String(r.permission_key)).sort();
    const expected = [...ROLE_PERMISSIONS[roleKey]].map(String).sort();
    assert(
      fromDb.length === expected.length && fromDb.every((p, i) => p === expected[i]),
      `Role ${roleKey} permissions changed`,
    );
  }
  console.log("3. Existing role permissions EXACTLY unchanged after UI restructuring");

  console.log("\nSidebar modules covered:");
  console.log(
    "  Overview: Command Center",
    "\n  Academics: Students, Attendance Calendar, Timetables, Staff Workload, Attendance Posting, Attendance Analytics, Faculty & Departments, Curriculum & Subjects",
    "\n  Examinations: Examinations, Results",
    "\n  Student Support: Mentoring & Risks",
    "\n  Operations: Pending & Exceptions, Reports, Alerts",
    "\n  System: User Management, Settings (+ semester dates)",
  );

  console.log("\nUnmapped cleanly (shared / placeholder nav):");
  console.log("  - Pending/Reports/Alerts → reuse dashboard.view");
  console.log("  - Attendance Analytics → reuses attendance.view");
  console.log("  - No separate attendance.edit key (post covers edit-with-reason)");
  console.log("  - Timetable review uses timetable.edit (not a separate key)");
  console.log("  - Mentoring & Risks → mentoring.view (+ students.view legacy nav access)");

  console.log("\nAll matrix compatibility checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
