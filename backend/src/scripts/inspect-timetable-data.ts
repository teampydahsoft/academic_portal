import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";

async function main() {
  const plans = await queryAcademic<(RowDataPacket & { id: number; status: string; section_name: string; college_id: number; branch_id: number })[]>(`
    SELECT id, status, section_name, college_id, branch_id, batch, academic_year_label
    FROM ap_timetable_plans
    ORDER BY id
  `);
  console.log("All plans:", JSON.stringify(plans, null, 2));

  for (const plan of plans) {
    const entries = await queryAcademic(`
      SELECT e.id, e.day_of_week, e.faculty_staff_link_id, e.subject_id,
             COALESCE(e.timing_slot_id, e.period_slot_id) slot_id,
             sl.display_name faculty
      FROM ap_timetable_entries e
      LEFT JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
      WHERE e.plan_id = ? AND e.subject_id IS NOT NULL
      LIMIT 5
    `, [plan.id]);
    console.log(`Plan ${plan.id} entries sample:`, entries);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
