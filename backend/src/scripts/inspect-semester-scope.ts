import "dotenv/config";
import { queryStudent } from "../db/pools.js";

async function main() {
  // Look for any table that might store branch-scoped semester dates
  const hits = await queryStudent(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND COLUMN_NAME IN ('start_date','end_date','semester_start_date','semester_end_date')
     ORDER BY TABLE_NAME`,
  );
  console.log("date columns", hits);

  // How many college-scoped vs null for batch 2023
  const scope = await queryStudent(
    `SELECT college_id, COUNT(*) c,
            SUM(start_date IS NOT NULL) dated
     FROM semesters
     WHERE TRIM(batch)='2023' AND course_id=1
     GROUP BY college_id`,
  );
  console.log("scope", scope);

  // courses total years for B.Tech
  const course = await queryStudent(
    `SELECT id, name, total_years, semesters_per_year, year_semester_config
     FROM courses WHERE id=1`,
  );
  console.log("course", course);

  // unique batches for college 1 course 1 from students
  const batches = await queryStudent(
    `SELECT DISTINCT TRIM(batch) AS batch FROM students
     WHERE college_id=1 AND course_id=1 AND batch IS NOT NULL AND TRIM(batch)<>''
     ORDER BY batch DESC LIMIT 20`,
  );
  console.log("batches", batches);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
