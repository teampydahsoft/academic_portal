/**
 * Keep only faculty_substitution as the active request type.
 * Run: npm run db:migrate:single-request-type
 */
import { executeAcademic, queryAcademic } from "../db/pools.js";
import { SUBSTITUTION_TYPE_KEY } from "../services/faculty-substitution.service.js";

async function main() {
  const substitution = await queryAcademic<{ id: number }[]>(
    `SELECT id FROM ap_request_types WHERE type_key = ? LIMIT 1`,
    [SUBSTITUTION_TYPE_KEY],
  );
  if (!substitution[0]) {
    throw new Error(
      `Missing ${SUBSTITUTION_TYPE_KEY} request type — run db:migrate:faculty-substitution first`,
    );
  }

  const deactivated = await executeAcademic(
    `UPDATE ap_request_types SET is_active = 0 WHERE type_key <> ?`,
    [SUBSTITUTION_TYPE_KEY],
  );

  await executeAcademic(
    `UPDATE ap_request_types SET is_active = 1 WHERE type_key = ?`,
    [SUBSTITUTION_TYPE_KEY],
  );

  console.log(
    `Single request type enforced: ${SUBSTITUTION_TYPE_KEY} (deactivated ${deactivated.affectedRows ?? 0} other type(s))`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
