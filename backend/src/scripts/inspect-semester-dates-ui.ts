import "dotenv/config";
import { queryStudent } from "../db/pools.js";

async function main() {
  const semCols = await queryStudent(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'semesters'
     ORDER BY ORDINAL_POSITION`,
  );
  console.log("semesters", JSON.stringify(semCols, null, 2));

  // Sample for Batch 2023 B.Tech Engineering (college 1 course 1) like the screenshot
  const rows = await queryStudent(
    `SELECT sem.id, sem.college_id, sem.course_id, c.name AS course_name,
            sem.academic_year_id, ay.year_label,
            sem.year_of_study, sem.batch, sem.semester_number,
            DATE_FORMAT(sem.start_date,'%Y-%m-%d') AS start_date,
            DATE_FORMAT(sem.end_date,'%Y-%m-%d') AS end_date
     FROM semesters sem
     LEFT JOIN courses c ON c.id = sem.course_id
     LEFT JOIN academic_years ay ON ay.id = sem.academic_year_id
     WHERE TRIM(sem.batch) = '2023'
       AND sem.course_id = 1
     ORDER BY sem.year_of_study, sem.semester_number, sem.college_id`,
  );
  console.log("batch 2023 course 1", JSON.stringify(rows, null, 2));

  // Does branch enter into semester dates somehow?
  const branchRelated = await queryStudent(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND (
         (TABLE_NAME LIKE '%sem%' AND COLUMN_NAME LIKE '%branch%')
         OR TABLE_NAME LIKE '%semester%date%'
         OR TABLE_NAME LIKE '%batch%sem%'
       )`,
  );
  console.log("branch-semester links", branchRelated);

  const bay = await queryStudent(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_academic_years'`,
  );
  console.log("branch_academic_years cols", bay);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
