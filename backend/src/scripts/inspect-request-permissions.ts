import "dotenv/config";
import { queryAcademic } from "../db/pools.js";

async function main() {
  const perms = await queryAcademic<{ id: number; permission_key: string }[]>(
    `SELECT id, permission_key FROM ap_permissions WHERE permission_key LIKE 'request.%' ORDER BY permission_key`,
  );
  console.log("=== ap_permissions (request.*) ===");
  console.log(perms);

  const role = await queryAcademic<{ id: number; role_key: string }[]>(
    `SELECT id, role_key FROM ap_roles WHERE role_key = 'super_admin' LIMIT 1`,
  );
  console.log("\n=== super_admin role ===");
  console.log(role);

  if (role[0]) {
    const rolePerms = await queryAcademic<{ permission_key: string }[]>(
      `
      SELECT p.permission_key
      FROM ap_role_permissions rp
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.permission_key LIKE 'request.%'
      ORDER BY p.permission_key
      `,
      [role[0].id],
    );
    console.log("\n=== super_admin request permissions in DB ===");
    console.log(rolePerms);
  }

  const superUsers = await queryAcademic<{ id: number; username: string; role_key: string }[]>(
    `
    SELECT u.id, u.username, r.role_key
    FROM ap_users u
    INNER JOIN ap_user_roles ur ON ur.user_id = u.id
    INNER JOIN ap_roles r ON r.id = ur.role_id
    WHERE r.role_key = 'super_admin'
    LIMIT 5
    `,
  );
  console.log("\n=== users with super_admin ===");
  console.log(superUsers);

  for (const user of superUsers) {
    const userId = user.id;
    const { loadAuthzContext } = await import("../authz/authorization.service.js");
    const authz = await loadAuthzContext(userId);
    console.log(`\n=== loadAuthzContext for ${user.username} (#${userId}) ===`);
    console.log(
      "request permissions:",
      authz.permissions.filter((p) => p.startsWith("request.")),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
