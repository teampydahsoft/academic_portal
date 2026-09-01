/**
 * Sync the faculty system role to the trimmed teaching-staff permission matrix.
 * Safe to run repeatedly — replaces ap_role_permissions for the faculty role only.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import { ROLE_PERMISSIONS } from "../authz/permissions.js";

async function main() {
  const roleRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = 'faculty' LIMIT 1`,
  );
  const roleId = roleRows[0]?.id;
  if (!roleId) {
    throw new Error("faculty role not found in ap_roles");
  }

  const permRows = await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
    `SELECT id, permission_key FROM ap_permissions WHERE is_active = 1`,
  );
  const permIdByKey = new Map(permRows.map((row) => [String(row.permission_key), Number(row.id)]));

  const target = ROLE_PERMISSIONS.faculty;
  await executeAcademic(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [roleId]);

  for (const permissionKey of target) {
    const permissionId = permIdByKey.get(permissionKey);
    if (!permissionId) throw new Error(`Missing permission row for ${permissionKey}`);
    await executeAcademic(
      `INSERT INTO ap_role_permissions (role_id, permission_id) VALUES (?, ?)`,
      [roleId, permissionId],
    );
  }

  console.log(`Synced faculty role: ${target.length} permissions`);
  console.log(target.join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
