import type { RowDataPacket } from "mysql2";
import { getHrmsDb, queryStudent, queryExam } from "../db/pools.js";

export async function listDepartments() {
  const db = await getHrmsDb();
  const departments = await db.collection("departments").find({}).limit(100).toArray();

  const sectionStats = await queryStudent<
    (RowDataPacket & { branch_name: string | null; sections: number; students: number })[]
  >(
    `
    SELECT
      cb.name AS branch_name,
      COUNT(DISTINCT CONCAT(ss.batch, '-', ss.section_name)) AS sections,
      COUNT(*) AS students
    FROM student_sections ss
    LEFT JOIN course_branches cb ON cb.id = ss.branch_id
    GROUP BY cb.name
    `,
  );

  return departments.map((raw) => {
    const doc = raw as Record<string, unknown>;
    const name =
      (typeof doc.name === "string" && doc.name) ||
      (typeof doc.departmentName === "string" && doc.departmentName) ||
      "Department";
    const match = sectionStats.find(
      (row) =>
        row.branch_name &&
        name.toLowerCase().includes(String(row.branch_name).toLowerCase()),
    );
    return {
      id: String(doc._id),
      name,
      faculty:
        typeof doc.employeeCount === "number"
          ? doc.employeeCount
          : undefined,
      sections: match ? Number(match.sections) : 0,
      students: match ? Number(match.students) : 0,
    };
  });
}

export async function listSubjects() {
  // Prefer curriculum mappings; fall back to subject master if mappings empty
  const mapped = await listCurriculum({});
  if (mapped.rows.length > 0) {
    return mapped.rows.map((row) => ({
      id: String(row.subjectId),
      code: row.code,
      name: row.name,
      type: row.type,
      credits: row.credits,
      semester: row.semester,
      year: row.year,
      status: row.status,
      branch: row.branchName,
      course: row.courseName,
      faculty: "—",
      sections: row.sectionMode === "all" ? "All" : row.sectionKey || "—",
      regulation: row.regulationCode,
      college: row.collegeName,
      batch: row.batch,
    }));
  }

  const examSubjects = await queryExam<
    (RowDataPacket & {
      id: number;
      code: string;
      name: string;
      type: string;
      credits: number;
      semester: number | null;
      yearOfStudy: number;
      status: string;
      branchName: string | null;
      courseName: string | null;
    })[]
  >(
    `
    SELECT
      id, code, name, type, credits, semester, yearOfStudy, status, branchName, courseName
    FROM subjects
    ORDER BY yearOfStudy, semester, code
    LIMIT 200
    `,
  );

  return examSubjects.map((row) => ({
    id: String(row.id),
    code: row.code,
    name: row.name,
    type: row.type,
    credits: Number(row.credits),
    semester: row.semester,
    year: row.yearOfStudy,
    status: row.status || "Active",
    branch: row.branchName ?? "—",
    course: row.courseName ?? "—",
    faculty: "—",
    sections: "—",
  }));
}

export async function listCurriculum(filters: {
  collegeId?: number;
  courseId?: number;
  branchId?: number;
  batch?: string;
  year?: number;
  semester?: number;
  section?: string;
}) {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.collegeId) {
    where.push("sme.collegeId = ?");
    params.push(filters.collegeId);
  }
  if (filters.courseId) {
    where.push("sme.courseId = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("sme.branchId = ?");
    params.push(filters.branchId);
  }
  if (filters.batch) {
    where.push("sme.batch = ?");
    params.push(filters.batch);
  }
  if (filters.year != null) {
    where.push("sme.yearOfStudy = ?");
    params.push(filters.year);
  }
  if (filters.semester != null) {
    where.push("sme.semester = ?");
    params.push(filters.semester);
  }
  if (filters.section) {
    where.push(`
      (
        sme.sectionMode = 'all'
        OR sme.sectionKey = '*'
        OR sme.sectionKey = ?
        OR sme.sections IS NULL
        OR sme.sections = ''
        OR sme.sections LIKE CONCAT('%', ?, '%')
      )
    `);
    params.push(filters.section, filters.section);
  }

  const rows = await queryExam<
    (RowDataPacket & {
      mappingId: number;
      regulationId: number;
      regulationCode: string | null;
      regulationName: string | null;
      collegeId: number | null;
      collegeName: string | null;
      courseId: number | null;
      courseName: string | null;
      branchId: number | null;
      branchName: string | null;
      batch: string | null;
      yearOfStudy: number | null;
      semester: number | null;
      sectionMode: string | null;
      sectionKey: string | null;
      subjectId: number;
      code: string;
      name: string;
      type: string;
      credits: number | null;
      status: string | null;
    })[]
  >(
    `
    SELECT
      sme.id AS mappingId,
      sme.regulationId,
      r.code AS regulationCode,
      r.name AS regulationName,
      sme.collegeId,
      sme.collegeName,
      sme.courseId,
      sme.courseName,
      sme.branchId,
      sme.branchName,
      sme.batch,
      sme.yearOfStudy,
      sme.semester,
      sme.sectionMode,
      sme.sectionKey,
      s.id AS subjectId,
      s.code,
      s.name,
      s.type,
      s.credits,
      s.status
    FROM subject_mapping_entries sme
    INNER JOIN subjects s ON s.id = sme.subjectId
    LEFT JOIN regulations r ON r.id = sme.regulationId
    WHERE ${where.join(" AND ")}
    ORDER BY
      sme.collegeName, sme.courseName, sme.branchName, sme.batch,
      sme.yearOfStudy, sme.semester, s.code
    LIMIT 1000
    `,
    params,
  );

  const mappedRows = rows.map((row) => ({
    mappingId: row.mappingId,
    regulationId: row.regulationId,
    regulationCode: row.regulationCode ?? "—",
    regulationName: row.regulationName ?? "—",
    collegeId: row.collegeId,
    collegeName: row.collegeName ?? "—",
    courseId: row.courseId,
    courseName: row.courseName ?? "—",
    branchId: row.branchId,
    branchName: row.branchName ?? "—",
    batch: row.batch ?? "—",
    year: row.yearOfStudy,
    semester: row.semester,
    sectionMode: row.sectionMode ?? "all",
    sectionKey: row.sectionKey ?? "*",
    subjectId: row.subjectId,
    code: row.code,
    name: row.name,
    type: row.type,
    credits: Number(row.credits ?? 0),
    status: row.status || "active",
  }));

  const groupMap = new Map<
    string,
    {
      key: string;
      regulationCode: string;
      regulationName: string;
      collegeName: string;
      courseName: string;
      branchName: string;
      batch: string;
      year: number | null;
      semester: number | null;
      subjects: typeof mappedRows;
    }
  >();

  for (const row of mappedRows) {
    const key = [
      row.regulationId,
      row.collegeId,
      row.courseId,
      row.branchId,
      row.batch,
      row.year,
      row.semester,
    ].join(":");
    const existing = groupMap.get(key);
    if (existing) {
      existing.subjects.push(row);
    } else {
      groupMap.set(key, {
        key,
        regulationCode: row.regulationCode,
        regulationName: row.regulationName,
        collegeName: row.collegeName,
        courseName: row.courseName,
        branchName: row.branchName,
        batch: row.batch,
        year: row.year,
        semester: row.semester,
        subjects: [row],
      });
    }
  }

  const groups = Array.from(groupMap.values());
  const uniqueSubjects = new Set(mappedRows.map((r) => r.subjectId));
  const uniqueRegulations = new Set(mappedRows.map((r) => r.regulationId));

  return {
    source: "ems.subject_mapping_entries",
    summary: {
      mappingCount: mappedRows.length,
      subjectCount: uniqueSubjects.size,
      regulationCount: uniqueRegulations.size,
      groupCount: groups.length,
    },
    groups,
    rows: mappedRows,
  };
}

export async function getExaminationOverview() {
  const [examCount, applicationCount, subjectCount, upcoming] = await Promise.all([
    queryExam<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total FROM exams`),
    queryExam<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM exam_applications`,
    ),
    queryExam<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total FROM subjects`),
    queryExam<
      (RowDataPacket & {
        id: number;
        name: string;
        type: string;
        status: string;
        course: string;
        branch: string;
        batch: string;
        examinationStartDate: string | null;
      })[]
    >(
      `
      SELECT id, name, type, status, course, branch, batch, examinationStartDate
      FROM exams
      ORDER BY id DESC
      LIMIT 10
      `,
    ),
  ]);

  return {
    upcomingExams: Number(examCount[0]?.total ?? 0),
    registered: Number(applicationCount[0]?.total ?? 0),
    subjects: Number(subjectCount[0]?.total ?? 0),
    exams: upcoming.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      course: row.course,
      branch: row.branch,
      batch: row.batch,
      startDate: row.examinationStartDate,
    })),
  };
}
