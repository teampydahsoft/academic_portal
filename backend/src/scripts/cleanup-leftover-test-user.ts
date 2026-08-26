/**
 * One-shot cleanup: remove the leftover HRMS-linked test user from User Management verification.
 * Does not touch Super Admin bootstrap.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";

const TARGET_EMAIL = "sr.manager@pydah.edu.in";
const TARGET_HRMS_ID = "695b8bf09fa26faa3ecdcc36";

async function main() {
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      name: string;
      email: string | null;
      username: string;
      hrms_employee_id: string | null;
      password_hash: string | null;
    })[]
  >(
    `
    SELECT id, name, email, username, hrms_employee_id, password_hash
    FROM ap_users
    WHERE LOWER(COALESCE(email, '')) = LOWER(?)
       OR hrms_employee_id = ?
       OR username = ?
    `,
    [TARGET_EMAIL, TARGET_HRMS_ID, TARGET_EMAIL],
  );

  if (!rows.length) {
    console.log("No matching leftover user found. Nothing to delete.");
    return;
  }

  for (const row of rows) {
    if (row.password_hash && !row.hrms_employee_id) {
      console.log(`Skipping local bootstrap user #${row.id} (${row.username})`);
      continue;
    }
    console.log(`Removing AP user #${row.id} ${row.name} <${row.email ?? row.username}>`);
    await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [row.id]);
    await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [row.id]);
    await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [row.id]);
    console.log(`Deleted user #${row.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
