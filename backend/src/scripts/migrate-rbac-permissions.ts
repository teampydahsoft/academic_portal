/**
 * Migrate RBAC to database-driven permissions.
 * Preserves ap_roles IDs and ap_user_roles assignments.
 * Seeds permission catalog + role_permissions to EXACTLY match ROLE_PERMISSIONS.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import {
  GLOBAL_SCOPE_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type RoleKey,
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
    description: "View attendance sessions and analytics",
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
    description: "View Academic Portal users and roles",
  },
  "user_management.manage_users": {
    module: "user_management",
    action: "manage_users",
    displayName: "Manage Users & Roles",
    description: "Link users, assign roles, manage role permissions",
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
};

async function columnExists(table: string, column: string) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function tableExists(table: string) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [table],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function exec(sql: string, params: unknown[] = []) {
  return executeAcademic(sql, params);
}

async function main() {
  console.log("=== RBAC dynamic permissions migration ===\n");

  const beforeRoles = await queryAcademic<(RowDataPacket & { id: number; role_key: string })[]>(
    `SELECT id, role_key FROM ap_roles ORDER BY id`,
  );
  const beforeAssignments = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM ap_user_roles`,
  );
  console.log("Existing roles:", beforeRoles.map((r) => `${r.id}:${r.role_key}`).join(", "));
  console.log("Existing user-role assignments:", Number(beforeAssignments[0]?.c ?? 0));

  // --- Alter ap_roles ---
  if (!(await columnExists("ap_roles", "is_system_role"))) {
    await exec(
      `ALTER TABLE ap_roles ADD COLUMN is_system_role TINYINT(1) NOT NULL DEFAULT 0 AFTER description`,
    );
    console.log("Added ap_roles.is_system_role");
  }
  if (!(await columnExists("ap_roles", "is_active"))) {
    await exec(
      `ALTER TABLE ap_roles ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER is_system_role`,
    );
    console.log("Added ap_roles.is_active");
  }
  if (!(await columnExists("ap_roles", "is_global_capable"))) {
    await exec(
      `ALTER TABLE ap_roles ADD COLUMN is_global_capable TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active`,
    );
    console.log("Added ap_roles.is_global_capable");
  }
  if (!(await columnExists("ap_roles", "updated_at"))) {
    await exec(
      `ALTER TABLE ap_roles ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`,
    );
    console.log("Added ap_roles.updated_at");
  }

  // Mark known system roles; preserve IDs
  for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    const isGlobal = GLOBAL_SCOPE_ROLES.includes(roleKey) ? 1 : 0;
    await exec(
      `
      UPDATE ap_roles
      SET is_system_role = 1, is_active = 1, is_global_capable = ?, updated_at = CURRENT_TIMESTAMP
      WHERE role_key = ?
      `,
      [isGlobal, roleKey],
    );
  }
  console.log("Marked system roles + global-capable flags");

  // --- ap_permissions ---
  if (!(await tableExists("ap_permissions"))) {
    await exec(`
      CREATE TABLE ap_permissions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        permission_key VARCHAR(128) NOT NULL,
        module VARCHAR(64) NOT NULL,
        action VARCHAR(64) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ap_permissions_key (permission_key),
        KEY idx_ap_permissions_module (module, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created ap_permissions");
  }

  for (const key of PERMISSIONS) {
    const meta = PERMISSION_META[key];
    await exec(
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
  console.log(`Seeded ${PERMISSIONS.length} permissions`);

  // --- ap_role_permissions ---
  if (!(await tableExists("ap_role_permissions"))) {
    await exec(`
      CREATE TABLE ap_role_permissions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        role_id INT UNSIGNED NOT NULL,
        permission_id INT UNSIGNED NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_role_permission (role_id, permission_id),
        KEY idx_role_permissions_role (role_id),
        KEY idx_role_permissions_perm (permission_id),
        CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES ap_roles(id),
        CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_id) REFERENCES ap_permissions(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created ap_role_permissions");
  }

  const permRows = await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
    `SELECT id, permission_key FROM ap_permissions`,
  );
  const permIdByKey = new Map(permRows.map((p) => [String(p.permission_key), Number(p.id)]));

  const roleRows = await queryAcademic<(RowDataPacket & { id: number; role_key: string })[]>(
    `SELECT id, role_key FROM ap_roles`,
  );
  const roleIdByKey = new Map(roleRows.map((r) => [String(r.role_key), Number(r.id)]));

  // For system roles: replace permission map to exact hardcoded matrix
  for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) {
      throw new Error(`Missing role ${roleKey} in ap_roles — aborting`);
    }
    await exec(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [roleId]);
    for (const permissionKey of ROLE_PERMISSIONS[roleKey]) {
      const permissionId = permIdByKey.get(permissionKey);
      if (!permissionId) throw new Error(`Missing permission ${permissionKey}`);
      await exec(
        `
        INSERT INTO ap_role_permissions (role_id, permission_id)
        VALUES (?, ?)
        `,
        [roleId, permissionId],
      );
    }
    console.log(`Seeded ${roleKey}: ${ROLE_PERMISSIONS[roleKey].length} permissions`);
  }

  // --- Compatibility check ---
  console.log("\n=== Backward compatibility comparison ===");
  let mismatches = 0;
  for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    const roleId = roleIdByKey.get(roleKey)!;
    const dbPerms = await queryAcademic<(RowDataPacket & { permission_key: string })[]>(
      `
      SELECT p.permission_key
      FROM ap_role_permissions rp
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.is_active = 1
      ORDER BY p.permission_key
      `,
      [roleId],
    );
    const fromDb = dbPerms.map((p) => String(p.permission_key)).sort();
    const fromCode = [...ROLE_PERMISSIONS[roleKey]].sort();
    const same =
      fromDb.length === fromCode.length && fromDb.every((p, i) => p === fromCode[i]);
    if (!same) {
      mismatches += 1;
      console.error(`MISMATCH ${roleKey}`);
      console.error("  code:", fromCode.join(", "));
      console.error("  db  :", fromDb.join(", "));
    } else {
      console.log(`EXACT MATCH ${roleKey} (${fromDb.length})`);
    }
  }

  const afterRoles = await queryAcademic<(RowDataPacket & { id: number; role_key: string })[]>(
    `SELECT id, role_key FROM ap_roles ORDER BY id`,
  );
  const afterAssignments = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM ap_user_roles`,
  );

  if (afterRoles.length !== beforeRoles.length) {
    throw new Error("Role count changed — abort");
  }
  for (const before of beforeRoles) {
    const after = afterRoles.find((r) => Number(r.id) === Number(before.id));
    if (!after || String(after.role_key) !== String(before.role_key)) {
      throw new Error(`Role id/key drift for id=${before.id}`);
    }
  }
  if (Number(afterAssignments[0]?.c ?? 0) !== Number(beforeAssignments[0]?.c ?? 0)) {
    throw new Error("User-role assignment count changed — abort");
  }

  if (mismatches > 0) {
    throw new Error(`Permission matrix mismatch count=${mismatches} — migration incomplete`);
  }

  console.log("\nMigration OK. Role IDs and user assignments preserved.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
