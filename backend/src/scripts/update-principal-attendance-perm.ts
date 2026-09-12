import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";

async function main() {
  console.log("=== Updating Principal Role Attendance Permissions ===");

  // Find principal role
  const roles = await queryAcademic<(RowDataPacket & { id: number; role_key: string })[]>(
    `SELECT id, role_key FROM ap_roles WHERE role_key = 'principal' LIMIT 1`,
  );
  if (!roles[0]) {
    throw new Error("Role 'principal' not found in ap_roles");
  }
  const principalRoleId = roles[0].id;

  // Find permission id for attendance.post
  const perms = await queryAcademic<(RowDataPacket & { id: number; permission_key: string })[]>(
    `SELECT id, permission_key FROM ap_permissions WHERE permission_key = 'attendance.post' LIMIT 1`,
  );
  if (!perms[0]) {
    throw new Error("Permission 'attendance.post' not found in ap_permissions");
  }
  const attendancePostPermId = perms[0].id;

  // Check if mapping already exists
  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_role_permissions WHERE role_id = ? AND permission_id = ?`,
    [principalRoleId, attendancePostPermId],
  );

  if (existing.length === 0) {
    await executeAcademic(
      `INSERT INTO ap_role_permissions (role_id, permission_id) VALUES (?, ?)`,
      [principalRoleId, attendancePostPermId],
    );
    console.log(`Successfully granted 'attendance.post' to role 'principal' (role_id: ${principalRoleId}, perm_id: ${attendancePostPermId}).`);
  } else {
    console.log(`Role 'principal' already has 'attendance.post'.`);
  }

  // Verify all roles and their attendance permissions
  const report = await queryAcademic<any[]>(
    `
    SELECT r.role_key, r.label, p.permission_key
    FROM ap_role_permissions rp
    JOIN ap_roles r ON r.id = rp.role_id
    JOIN ap_permissions p ON p.id = rp.permission_id
    WHERE p.permission_key LIKE '%attendance%'
    ORDER BY r.id, p.permission_key
    `,
  );
  console.log("\n=== Active Attendance Permissions Per Role ===");
  console.log(report);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
