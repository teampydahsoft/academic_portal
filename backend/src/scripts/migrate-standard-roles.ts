/**
 * Consolidate portal roles to the five standard keys:
 * super_admin, principal, vice_principal, hod, staff
 *
 * Renames legacy roles, migrates user assignments & workflow approvers,
 * deactivates removed roles, then re-seeds permissions from ROLE_PERMISSIONS.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import {
  GLOBAL_SCOPE_ROLES,
  LEGACY_ROLE_KEY_MAP,
  ROLE_PERMISSIONS,
  STANDARD_ROLE_KEYS,
  type RoleKey,
} from "../authz/permissions.js";

type RoleRow = RowDataPacket & { id: number; role_key: string };

const ROLE_RENAMES: { from: string; to: RoleKey; label: string; description: string }[] = [
  {
    from: "system_admin",
    to: "super_admin",
    label: "Super Admin",
    description: "Full portal administration and integrations",
  },
  {
    from: "faculty",
    to: "staff",
    label: "Staff",
    description: "Teaching staff — own timetable, attendance, and requests",
  },
  {
    from: "management",
    to: "vice_principal",
    label: "Vice Principal",
    description: "Academic operations, timetables, and request workflow oversight",
  },
];

const DEPRECATED_ROLE_TARGETS: Record<string, RoleKey> = {
  academic_admin: "vice_principal",
  exam_cell: "staff",
  auditor: "principal",
};

async function loadRoleByKey(roleKey: string) {
  const rows = await queryAcademic<RoleRow[]>(
    `SELECT id, role_key FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  return rows[0] ?? null;
}

async function ensureStandardRole(
  roleKey: RoleKey,
  label: string,
  description: string,
) {
  const existing = await loadRoleByKey(roleKey);
  if (existing) {
    const isGlobal = GLOBAL_SCOPE_ROLES.includes(roleKey) ? 1 : 0;
    await executeAcademic(
      `
      UPDATE ap_roles
      SET label = ?, description = ?, is_system_role = 1, is_active = 1,
          is_global_capable = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [label, description, isGlobal, existing.id],
    );
    return Number(existing.id);
  }

  const isGlobal = GLOBAL_SCOPE_ROLES.includes(roleKey) ? 1 : 0;
  const result = await executeAcademic(
    `
    INSERT INTO ap_roles
      (role_key, label, description, is_system_role, is_active, is_global_capable)
    VALUES (?, ?, ?, 1, 1, ?)
    `,
    [roleKey, label, description, isGlobal],
  );
  return Number(result.insertId);
}

async function migrateUserRoles(fromRoleId: number, toRoleId: number) {
  if (fromRoleId === toRoleId) return 0;

  const assignments = await queryAcademic<
    (RowDataPacket & { id: number; user_id: number; college_id: number | null; branch_id: number | null })[]
  >(
    `SELECT id, user_id, college_id, branch_id FROM ap_user_roles WHERE role_id = ?`,
    [fromRoleId],
  );

  let migrated = 0;
  for (const row of assignments) {
    const duplicate = await queryAcademic<(RowDataPacket & { id: number })[]>(
      `
      SELECT id FROM ap_user_roles
      WHERE user_id = ? AND role_id = ?
        AND ((college_id IS NULL AND ? IS NULL) OR college_id = ?)
        AND ((branch_id IS NULL AND ? IS NULL) OR branch_id = ?)
      LIMIT 1
      `,
      [
        row.user_id,
        toRoleId,
        row.college_id,
        row.college_id,
        row.branch_id,
        row.branch_id,
      ],
    );
    if (duplicate[0]) {
      await executeAcademic(`DELETE FROM ap_user_roles WHERE id = ?`, [row.id]);
    } else {
      await executeAcademic(`UPDATE ap_user_roles SET role_id = ? WHERE id = ?`, [
        toRoleId,
        row.id,
      ]);
    }
    migrated += 1;
  }
  return migrated;
}

async function deactivateRole(roleId: number) {
  await executeAcademic(
    `
    UPDATE ap_roles
    SET is_active = 0, is_system_role = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [roleId],
  );
  await executeAcademic(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [roleId]);
}

async function seedRolePermissions() {
  const permRows = await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
    `SELECT id, permission_key FROM ap_permissions WHERE is_active = 1`,
  );
  const permIdByKey = new Map(permRows.map((p) => [String(p.permission_key), Number(p.id)]));

  for (const roleKey of STANDARD_ROLE_KEYS) {
    const role = await loadRoleByKey(roleKey);
    if (!role) {
      console.warn(`Skipping permission seed — role missing: ${roleKey}`);
      continue;
    }
    const roleId = Number(role.id);
    await executeAcademic(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [roleId]);
    for (const permissionKey of ROLE_PERMISSIONS[roleKey]) {
      const permissionId = permIdByKey.get(permissionKey);
      if (!permissionId) {
        console.warn(`  Missing permission catalog entry: ${permissionKey}`);
        continue;
      }
      await executeAcademic(
        `INSERT INTO ap_role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleId, permissionId],
      );
    }
    console.log(`Seeded ${roleKey}: ${ROLE_PERMISSIONS[roleKey].length} permissions`);
  }
}

async function main() {
  console.log("=== Standard roles migration ===\n");

  const before = await queryAcademic<RoleRow[]>(
    `SELECT id, role_key FROM ap_roles ORDER BY id`,
  );
  console.log("Before:", before.map((r) => r.role_key).join(", "));

  // 1. Rename in-place where target key is free
  for (const rename of ROLE_RENAMES) {
    const from = await loadRoleByKey(rename.from);
    if (!from) continue;
    const targetExists = await loadRoleByKey(rename.to);
    if (targetExists && Number(targetExists.id) !== Number(from.id)) {
      console.log(`Rename skipped ${rename.from} → ${rename.to} (target already exists)`);
      continue;
    }
    const isGlobal = GLOBAL_SCOPE_ROLES.includes(rename.to) ? 1 : 0;
    await executeAcademic(
      `
      UPDATE ap_roles
      SET role_key = ?, label = ?, description = ?, is_system_role = 1, is_active = 1,
          is_global_capable = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [rename.to, rename.label, rename.description, isGlobal, from.id],
    );
    console.log(`Renamed ${rename.from} → ${rename.to}`);
  }

  // 2. Ensure principal, hod, vice_principal exist
  await ensureStandardRole(
    "principal",
    "Principal",
    "Institution oversight and approvals",
  );
  await ensureStandardRole(
    "hod",
    "Head of Department",
    "Department timetable, workload, and approvals",
  );
  await ensureStandardRole(
    "vice_principal",
    "Vice Principal",
    "Academic operations, timetables, and request workflow oversight",
  );
  await ensureStandardRole(
    "super_admin",
    "Super Admin",
    "Full portal administration and integrations",
  );
  await ensureStandardRole(
    "staff",
    "Staff",
    "Teaching staff — own timetable, attendance, and requests",
  );

  // 3. Migrate users off deprecated roles
  for (const [deprecatedKey, targetKey] of Object.entries(DEPRECATED_ROLE_TARGETS)) {
    const deprecated = await loadRoleByKey(deprecatedKey);
    if (!deprecated) continue;
    const target = await loadRoleByKey(targetKey);
    if (!target) throw new Error(`Target role missing: ${targetKey}`);
    const count = await migrateUserRoles(Number(deprecated.id), Number(target.id));
    await deactivateRole(Number(deprecated.id));
    console.log(`Deprecated ${deprecatedKey}: migrated ${count} assignment(s) → ${targetKey}`);
  }

  // 4. Deactivate any other non-standard active roles
  const allRoles = await queryAcademic<RoleRow[]>(`SELECT id, role_key FROM ap_roles`);
  for (const role of allRoles) {
    const key = String(role.role_key);
    if (STANDARD_ROLE_KEYS.includes(key as RoleKey)) continue;
    if (Object.keys(LEGACY_ROLE_KEY_MAP).includes(key)) {
      const mapped = LEGACY_ROLE_KEY_MAP[key];
      const target = await loadRoleByKey(mapped);
      if (target) {
        const count = await migrateUserRoles(Number(role.id), Number(target.id));
        if (count > 0) {
          console.log(`Migrated legacy ${key}: ${count} assignment(s) → ${mapped}`);
        }
      }
    }
    await deactivateRole(Number(role.id));
    console.log(`Deactivated non-standard role: ${key}`);
  }

  // 5. Update workflow approver role keys
  const workflowUpdates: [string, RoleKey][] = [
    ["system_admin", "super_admin"],
    ["faculty", "staff"],
    ["management", "vice_principal"],
    ["academic_admin", "vice_principal"],
    ["exam_cell", "staff"],
    ["auditor", "principal"],
  ];
  for (const [from, to] of workflowUpdates) {
    const result = await executeAcademic(
      `
      UPDATE ap_request_workflow_steps
      SET approver_role_key = ?
      WHERE approver_role_key = ?
      `,
      [to, from],
    );
    const changed = Number(result.affectedRows ?? 0);
    if (changed > 0) {
      console.log(`Workflow steps: ${from} → ${to} (${changed})`);
    }
  }

  await executeAcademic(
    `
    UPDATE ap_request_workflow_steps
    SET step_key = 'vice_principal_review',
        label = 'Vice Principal Review'
    WHERE step_key = 'management_review'
    `,
  );

  // 6. Re-seed permissions for standard roles
  await seedRolePermissions();

  const after = await queryAcademic<RoleRow[]>(
    `SELECT id, role_key, is_active FROM ap_roles WHERE is_active = 1 ORDER BY id`,
  );
  console.log("\nActive roles after migration:", after.map((r) => r.role_key).join(", "));
  console.log("\nMigration OK.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
