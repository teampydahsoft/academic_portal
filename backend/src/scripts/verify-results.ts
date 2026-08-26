import "dotenv/config";
import {
  getExamResults,
  getStudentResults,
  listResults,
} from "../services/results.service.js";
import { queryAcademic, queryExam } from "../db/pools.js";
import type { RowDataPacket } from "mysql2";

async function main() {
  console.log("=== Results module live verification ===\n");

  const counts = await queryExam<RowDataPacket[]>(
    `SELECT
      (SELECT COUNT(*) FROM subject_results) AS subject_results,
      (SELECT COUNT(*) FROM result_uploads) AS result_uploads`,
  );
  console.log("1. EMS counts", counts[0]);

  const list = await listResults({});
  console.log("\n2. listResults", {
    total: list.total,
    count: list.count,
    summary: list.summary,
    source: list.source.results,
    firstRow: list.data[0] ?? null,
  });

  if (list.summary != null && list.total === 0) {
    throw new Error("Summary must be null when total is 0");
  }
  if (list.total === 0 && list.data.length !== 0) {
    throw new Error("Expected empty data when total is 0");
  }

  const exam = await getExamResults(1);
  console.log("\n3. getExamResults(1)", {
    exam: exam?.exam.name,
    resultCount: exam?.resultCount,
    summary: exam?.summary,
    uploads: exam?.uploads.length,
  });
  if (exam && exam.resultCount === 0 && exam.summary != null) {
    throw new Error("Exam summary must be null when no results");
  }

  const student = await getStudentResults("256T1DAH29");
  console.log("\n4. getStudentResults(256T1DAH29)", {
    student: student?.student,
    resultCount: student?.resultCount,
    summary: student?.summary,
    examinations: student?.examinations.length,
  });
  if (student && student.resultCount === 0 && student.summary != null) {
    throw new Error("Student summary must be null when no results");
  }

  // Ensure we never query courseId for results / selectedSubjectIds
  const serviceSrc = await import("fs").then((fs) =>
    fs.readFileSync(new URL("../services/results.service.ts", import.meta.url), "utf8"),
  );
  if (/\bsubjects\.courseId\b/.test(serviceSrc) && !serviceSrc.includes("Do NOT use subjects.courseId")) {
    throw new Error("results.service must not use subjects.courseId");
  }
  // Strip comments, then assert forbidden identifiers are absent from executable code
  const codeOnly = serviceSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  if (/\bsubjects\.courseId\b/.test(codeOnly)) {
    throw new Error("results.service must not use subjects.courseId");
  }
  if (/\bselectedSubjectIds\b/.test(codeOnly)) {
    throw new Error("results.service must not use selectedSubjectIds");
  }
  if (/\binternalMarks\b|\bexternalMarks\b|\btotalMarks\b/.test(codeOnly)) {
    throw new Error("Must not select numeric paper maxima as student marks");
  }

  const apTables = await queryAcademic<RowDataPacket[]>(
    `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND LOWER(TABLE_NAME) LIKE '%result%'
    ORDER BY TABLE_NAME
    `,
  );
  console.log("\n5. Academic Portal result tables (expect none)", {
    tables: apTables.map((t) => t.TABLE_NAME),
  });
  if (apTables.length > 0) {
    throw new Error("Unexpected Academic Portal result tables");
  }

  console.log("\nOK — Results verification completed (empty EMS state handled).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
