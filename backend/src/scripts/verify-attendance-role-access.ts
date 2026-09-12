import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";
import { loadAuthzContext } from "../authz/authorization.service.js";
import { ROLE_PERMISSIONS } from "../authz/permissions.js";

async function main() {
  console.log("==================================================");
  console.log("  VERIFY ATTENDANCE ROLE ACCESS & PERMISSIONS     ");
  console.log("==================================================\n");

  // 1. Verify DB permissions for all standard roles
  const [dbPerms] = await Promise.all([
    queryAcademic<(RowDataPacket & { role_key: string; permission_key: string })[]>(
      `
      SELECT r.role_key, p.permission_key
      FROM ap_role_permissions rp
      JOIN ap_roles r ON r.id = rp.role_id
      JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE p.permission_key LIKE 'attendance%'
      ORDER BY r.role_key, p.permission_key
      `,
    ),
  ]);

  const byRole = new Map<string, string[]>();
  for (const row of dbPerms) {
    if (!byRole.has(row.role_key)) byRole.set(row.role_key, []);
    byRole.get(row.role_key)!.push(row.permission_key);
  }

  console.log("1. Database Attendance Permissions per Role:");
  for (const [role, perms] of byRole.entries()) {
    console.log(`   - ${role.padEnd(16)}: ${perms.join(", ")}`);
  }

  // Check that all non-super-admin roles have attendance.post
  const nonAdminRoles = ["principal", "vice_principal", "hod", "staff"];
  for (const role of nonAdminRoles) {
    const hasPost = byRole.get(role)?.includes("attendance.post");
    const hasView = byRole.get(role)?.includes("attendance.view");
    if (!hasPost || !hasView) {
      throw new Error(`Role ${role} is missing attendance permissions! hasPost: ${hasPost}, hasView: ${hasView}`);
    }
    console.log(`   [PASS] Role '${role}' has attendance.view and attendance.post in DB.`);
  }

  // 2. Check memory reference ROLE_PERMISSIONS in backend
  console.log("\n2. In-Memory ROLE_PERMISSIONS catalog:");
  for (const role of nonAdminRoles) {
    const inMem = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    if (!inMem.includes("attendance.post")) {
      throw new Error(`In-memory ROLE_PERMISSIONS['${role}'] is missing 'attendance.post'!`);
    }
    console.log(`   [PASS] ROLE_PERMISSIONS['${role}'] includes attendance.post.`);
  }

  // 3. Check loadAuthzContext for sample users
  console.log("\n3. Testing Runtime Authorization Context:");
  const users = await queryAcademic<(RowDataPacket & { id: number; username: string; role_key: string })[]>(
    `
    SELECT u.id, u.username, r.role_key
    FROM ap_users u
    JOIN ap_user_roles ur ON ur.user_id = u.id
    JOIN ap_roles r ON r.id = ur.role_id
    WHERE r.role_key IN ('super_admin', 'principal', 'vice_principal', 'hod', 'staff')
    GROUP BY r.role_key
    `,
  );

  for (const u of users) {
    const authz = await loadAuthzContext(u.id);
    const canPost = authz.permissions.includes("attendance.post");
    const canView = authz.permissions.includes("attendance.view");
    console.log(`   - User '${u.username}' (#${u.id}, role: ${u.role_key}):`);
    console.log(`     attendance.view: ${canView}, attendance.post: ${canPost}`);
  }

  console.log("\n==================================================");
  console.log("  ALL ATTENDANCE ACCESS VERIFICATIONS PASSED!     ");
  console.log("==================================================");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
