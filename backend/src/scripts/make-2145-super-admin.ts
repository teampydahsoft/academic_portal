/**
 * Make HRMS employee 2145 (PENKEY TEJA) an Academic Portal Super Admin (super_admin, global).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import {
  getManagedUser,
  linkHrmsUser,
  replaceUserRoles,
  searchHrmsCandidates,
} from "../services/user-management.service.js";

async function main() {
  const actorRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = 'superadmin' OR password_hash IS NOT NULL LIMIT 1`,
  );
  const actorUserId = Number(actorRows[0]?.id);
  if (!actorUserId) throw new Error("No Super Admin actor found");

  // Already linked by emp id?
  const existing = await queryAcademic<(RowDataPacket & { id: number; name: string })[]>(
    `
    SELECT id, name FROM ap_users
    WHERE hrms_employee_id = '2145'
       OR LOWER(COALESCE(email, '')) = 'teja@pydahsoft.in'
    LIMIT 1
    `,
  );

  let userId: number;
  if (existing[0]) {
    userId = Number(existing[0].id);
    console.log(`Found existing portal user #${userId} (${existing[0].name})`);
  } else {
    const candidates = await searchHrmsCandidates("2145", 5);
    const teja = candidates.find((c) => c.employeeId === "2145" && c.canLink);
    if (!teja) {
      throw new Error(
        `Employee 2145 not found/linkable. Search returned: ${JSON.stringify(candidates)}`,
      );
    }
    const linked = await linkHrmsUser({
      hrmsUserId: teja.hrmsUserId,
      roleKey: "super_admin",
      scopes: [{ collegeId: null, branchId: null }],
      actorUserId,
    });
    userId = linked.id;
    console.log(`Linked employee 2145 as portal user #${userId} (${linked.name})`);
  }

  // Ensure super_admin global (and only that for this request — keep other roles if any? User asked for super admin)
  await replaceUserRoles({
    userId,
    assignments: [{ roleKey: "super_admin", collegeId: null, branchId: null }],
    actorUserId,
  });

  // Ensure active
  await executeAcademic(`UPDATE ap_users SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    userId,
  ]);

  const detail = await getManagedUser(userId);
  console.log(
    JSON.stringify(
      {
        id: detail?.id,
        name: detail?.name,
        email: detail?.email,
        username: detail?.username,
        hrmsEmployeeId: detail?.hrmsEmployeeId,
        isActive: detail?.isActive,
        isLocalBootstrap: detail?.isLocalBootstrap,
        roles: detail?.roles,
        permissionsCount: detail?.permissions?.length ?? 0,
      },
      null,
      2,
    ),
  );
  console.log("\nOK — Emp 2145 is now Academic Portal Super Admin (super_admin, global).");
  console.log(
    "They sign in with HRMS email/employee id + HRMS password once an HRMS login exists for them.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
