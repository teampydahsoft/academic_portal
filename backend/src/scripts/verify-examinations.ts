import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";
import {
  getExaminationDetail,
  getStudentExaminations,
  listExaminationApplications,
  listExaminationScopes,
  listExaminationSubjects,
  listExaminations,
} from "../services/examinations.service.js";

async function main() {
  console.log("=== Examinations module verification ===\n");

  const list = await listExaminations({});
  console.log("1. All exams", {
    count: list.count,
    names: list.data.map((e) => `${e.id}:${e.name} [${e.course}/${e.type}/${e.status}]`),
  });

  const mtech = list.data.find(
    (exam) => exam.course?.toLowerCase().includes("m.tech") && exam.status === "published",
  );
  if (!mtech) throw new Error("No published M.Tech exam found");
  console.log("\n2. Published M.Tech exam", {
    id: mtech.id,
    name: mtech.name,
    regulation: mtech.regulationCode,
    batch: mtech.batch,
    year: mtech.yearOfStudy,
    semester: mtech.semester,
    papers: mtech.subjectCount,
    applications: mtech.applicationCount,
    scopes: mtech.scopeCount,
  });

  const detail = await getExaminationDetail(mtech.id);
  if (!detail) throw new Error("Detail missing");
  console.log("\n3. Detail payload", {
    scopes: detail.scopes.length,
    subjects: detail.subjects.length,
    applications: detail.applications.length,
    samplePaper: detail.subjects[0],
    sampleScope: detail.scopes[0],
    sampleApp: detail.applications[0]
      ? {
          roll: detail.applications[0].studentRollNumber,
          name: detail.applications[0].studentName,
          subjects: detail.applications[0].selectedSubjects.map((s) => s.subjectCode),
          feeStatus: detail.applications[0].feeStatus,
        }
      : null,
  });

  const [scopes, subjects, applications] = await Promise.all([
    listExaminationScopes(mtech.id),
    listExaminationSubjects(mtech.id),
    listExaminationApplications(mtech.id),
  ]);
  console.log("\n4. Nested endpoints", {
    scopes: scopes?.count,
    subjects: subjects?.count,
    applications: applications?.count,
  });

  const filtered = await listExaminations({ courseId: undefined, q: "M.Tech" });
  console.log("\n5. Search M.Tech", filtered.data.map((e) => e.name));

  const mtechRegular = list.data.find((exam) => exam.id === 1) ?? mtech;
  const regularDetail = await getExaminationDetail(mtechRegular.id);
  console.log("\n2b. M.Tech regular exam 25MT12RAUG26 t", {
    id: mtechRegular.id,
    scopes: regularDetail?.scopes.length,
    subjects: regularDetail?.subjects.length,
    applications: regularDetail?.applications.length,
    firstApp: regularDetail?.applications[0]?.studentRollNumber,
  });
  const sampleRoll =
    regularDetail?.applications[0]?.studentRollNumber ??
    detail.applications[0]?.studentRollNumber;
  if (sampleRoll) {
    const studentView = await getStudentExaminations({ rollNumber: sampleRoll });
    console.log("\n6. Student exam view", {
      found: Boolean(studentView),
      student: studentView?.student,
      eligible: studentView?.eligibleExams.map((e) => e.name),
      registered: studentView?.applications.map((a) => ({
        exam: a.exam?.name,
        subjects: a.selectedSubjects.map((s) => s.subjectCode),
      })),
    });
  } else {
    console.log("\n6. Student exam view skipped (no applications)");
  }

  const apTables = await queryAcademic<RowDataPacket[]>(
    `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        TABLE_NAME LIKE '%exam%'
        OR TABLE_NAME LIKE '%application%'
      )
    ORDER BY TABLE_NAME
    `,
  );
  console.log("\n7. Academic Portal exam tables (expect none/unrelated)", {
    tables: apTables.map((row) => row.TABLE_NAME),
  });

  console.log("\nOK — Examinations verification completed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
