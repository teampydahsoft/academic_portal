import type { RowDataPacket } from "mysql2";
import { queryExam, queryStudent } from "../db/pools.js";

/**
 * Results are owned by EMS (examination_portal.subject_results).
 * Academic Portal reads them only — no AP result tables, no writes.
 *
 * Identity:
 *   examId            → exams.id
 *   studentRollNumber → student_database.students.pin_no (string match, no FK)
 *   subjectCode       → subjects.code (scoped via exam_subjects for the exam)
 *
 * Do NOT use subjects.courseId or exam_applications.selectedSubjectIds.
 */

export type ResultFilters = {
  collegeId?: number;
  courseId?: number;
  branchId?: number;
  batch?: string;
  year?: number;
  semester?: number;
  examId?: number;
  examType?: string;
  student?: string;
  resultStatus?: "pass" | "fail";
  q?: string;
  limit?: number;
  offset?: number;
};

type ResultRow = RowDataPacket & {
  id: number;
  uploadId: number | null;
  examId: number;
  studentRollNumber: string;
  studentName: string | null;
  subjectCode: string;
  subjectName: string;
  grade: string;
  passed: number;
  credits: string | number;
  gradePoints: string | number | null;
  examType: string | null;
  yearOfStudy: number;
  semester: number;
  attemptNumber: number;
  createdAt: string | null;
  updatedAt: string | null;
  examName: string | null;
  examTypeHeader: string | null;
  examStatus: string | null;
  examCollege: string | null;
  examCourse: string | null;
  examBranch: string | null;
  examBatch: string | null;
  uploadFileName: string | null;
  uploadUploadedBy: string | null;
  uploadCreatedAt: string | null;
  uploadRowCount: number | null;
  uploadStudentCount: number | null;
};

type ExamMetaRow = RowDataPacket & {
  id: number;
  name: string;
  type: string | null;
  status: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
  yearOfStudy: number | null;
  semester: number | null;
  publishedAt: string | null;
};

type PaperRow = RowDataPacket & {
  examId: number;
  subjectId: number;
  code: string | null;
  name: string | null;
  type: string | null;
};

type StudentRow = RowDataPacket & {
  id: number;
  pin_no: string | null;
  admission_number: string;
  student_name: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function like(value: string) {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function resultLabel(passed: number | boolean): "Pass" | "Fail" {
  return Number(passed) === 1 ? "Pass" : "Fail";
}

async function resolveStudentDbLabels(filters: ResultFilters) {
  let collegeName: string | undefined;
  let courseName: string | undefined;
  let branchName: string | undefined;

  if (filters.collegeId != null) {
    const rows = await queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM colleges WHERE id = ? LIMIT 1`,
      [filters.collegeId],
    );
    collegeName = text(rows[0]?.name) ?? undefined;
  }
  if (filters.courseId != null) {
    const rows = await queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM courses WHERE id = ? LIMIT 1`,
      [filters.courseId],
    );
    courseName = text(rows[0]?.name) ?? undefined;
  }
  if (filters.branchId != null) {
    const rows = await queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM course_branches WHERE id = ? LIMIT 1`,
      [filters.branchId],
    );
    branchName = text(rows[0]?.name) ?? undefined;
  }

  return { collegeName, courseName, branchName };
}

/** Exam ids matching academic-context filters via exam header / exam_scopes. */
async function matchingExamIds(
  filters: ResultFilters,
  labels: Awaited<ReturnType<typeof resolveStudentDbLabels>>,
): Promise<number[] | null> {
  const hasScopeFilter =
    Boolean(labels.collegeName) ||
    Boolean(labels.courseName) ||
    filters.branchId != null ||
    Boolean(labels.branchName) ||
    Boolean(filters.batch) ||
    filters.year != null ||
    filters.semester != null;

  if (!hasScopeFilter && filters.examId == null) return null;

  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.examId != null) {
    where.push("e.id = ?");
    params.push(filters.examId);
  }

  if (hasScopeFilter) {
    const scopeClauses: string[] = ["s.examId = e.id"];
    const scopeParams: unknown[] = [];
    const headerClauses: string[] = [];
    const headerParams: unknown[] = [];

    if (labels.collegeName) {
      scopeClauses.push(`(TRIM(COALESCE(s.college, '')) = '' OR LOWER(TRIM(s.college)) = LOWER(?))`);
      scopeParams.push(labels.collegeName);
      headerClauses.push(`(TRIM(COALESCE(e.college, '')) = '' OR LOWER(TRIM(e.college)) = LOWER(?))`);
      headerParams.push(labels.collegeName);
    }
    if (labels.courseName) {
      scopeClauses.push(`(TRIM(COALESCE(s.course, '')) = '' OR LOWER(TRIM(s.course)) = LOWER(?))`);
      scopeParams.push(labels.courseName);
      headerClauses.push(`(TRIM(COALESCE(e.course, '')) = '' OR LOWER(TRIM(e.course)) = LOWER(?))`);
      headerParams.push(labels.courseName);
    }
    if (filters.branchId != null || labels.branchName) {
      const branchParts = ["TRIM(COALESCE(s.branch, '')) = ''"];
      if (filters.branchId != null) {
        branchParts.push("s.branchId = ?");
        scopeParams.push(filters.branchId);
      }
      if (labels.branchName) {
        branchParts.push("LOWER(TRIM(s.branch)) = LOWER(?)");
        scopeParams.push(labels.branchName);
        headerClauses.push(`(TRIM(COALESCE(e.branch, '')) = '' OR LOWER(TRIM(e.branch)) = LOWER(?))`);
        headerParams.push(labels.branchName);
      }
      scopeClauses.push(`(${branchParts.join(" OR ")})`);
    }
    if (filters.batch) {
      scopeClauses.push(`(TRIM(COALESCE(s.batch, '')) = '' OR LOWER(TRIM(s.batch)) = LOWER(?))`);
      scopeParams.push(filters.batch);
      headerClauses.push(`(TRIM(COALESCE(e.batch, '')) = '' OR LOWER(TRIM(e.batch)) = LOWER(?))`);
      headerParams.push(filters.batch);
    }
    if (filters.year != null) {
      scopeClauses.push(`(s.yearOfStudy IS NULL OR s.yearOfStudy = ?)`);
      scopeParams.push(filters.year);
      headerClauses.push(`(e.yearOfStudy IS NULL OR e.yearOfStudy = ?)`);
      headerParams.push(filters.year);
    }
    if (filters.semester != null) {
      scopeClauses.push(`(s.semester IS NULL OR s.semester = ?)`);
      scopeParams.push(filters.semester);
      headerClauses.push(`(e.semester IS NULL OR e.semester = ?)`);
      headerParams.push(filters.semester);
    }

    where.push(`(
      EXISTS (SELECT 1 FROM exam_scopes s WHERE ${scopeClauses.join(" AND ")})
      OR (
        NOT EXISTS (SELECT 1 FROM exam_scopes s2 WHERE s2.examId = e.id)
        AND ${headerClauses.length ? headerClauses.join(" AND ") : "1=1"}
      )
    )`);
    params.push(...scopeParams, ...headerParams);
  }

  const rows = await queryExam<(RowDataPacket & { id: number })[]>(
    `SELECT e.id FROM exams e WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows.map((row) => Number(row.id));
}

function buildResultWhere(
  filters: ResultFilters,
  examIds: number[] | null,
): { where: string[]; params: unknown[] } {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (examIds != null) {
    if (!examIds.length) {
      where.push("1=0");
    } else {
      where.push(`sr.examId IN (${examIds.map(() => "?").join(",")})`);
      params.push(...examIds);
    }
  } else if (filters.examId != null) {
    where.push("sr.examId = ?");
    params.push(filters.examId);
  }

  if (filters.examType) {
    where.push(`(
      LOWER(TRIM(COALESCE(sr.examType, ''))) = ?
      OR LOWER(TRIM(COALESCE(e.type, ''))) = ?
    )`);
    const t = filters.examType.trim().toLowerCase();
    params.push(t, t);
  }

  if (filters.resultStatus === "pass") {
    where.push("sr.passed = 1");
  } else if (filters.resultStatus === "fail") {
    where.push("sr.passed = 0");
  }

  if (filters.student) {
    const term = like(filters.student.trim());
    where.push(`(
      sr.studentRollNumber LIKE ?
      OR sr.studentName LIKE ?
    )`);
    params.push(term, term);
  }

  if (filters.q) {
    const term = like(filters.q.trim());
    where.push(`(
      sr.studentRollNumber LIKE ?
      OR sr.studentName LIKE ?
      OR sr.subjectCode LIKE ?
      OR sr.subjectName LIKE ?
      OR e.name LIKE ?
      OR sr.grade LIKE ?
    )`);
    params.push(term, term, term, term, term, term);
  }

  return { where, params };
}

async function loadExamPapers(examIds: number[]): Promise<Map<string, PaperRow>> {
  const map = new Map<string, PaperRow>();
  if (!examIds.length) return map;
  const placeholders = examIds.map(() => "?").join(",");
  const rows = await queryExam<PaperRow[]>(
    `
    SELECT es.examId, es.subjectId, s.code, s.name, s.type
    FROM exam_subjects es
    INNER JOIN subjects s ON s.id = es.subjectId
    WHERE es.examId IN (${placeholders})
    `,
    examIds,
  );
  for (const row of rows) {
    const code = text(row.code);
    if (!code) continue;
    map.set(`${Number(row.examId)}::${norm(code)}`, row);
  }
  return map;
}

async function loadStudentsByRoll(rolls: string[]): Promise<Map<string, StudentRow>> {
  const map = new Map<string, StudentRow>();
  const unique = [...new Set(rolls.map((r) => r.trim()).filter(Boolean))];
  if (!unique.length) return map;

  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await queryStudent<StudentRow[]>(
      `
      SELECT id, pin_no, admission_number, student_name, college, course, branch, batch
      FROM students
      WHERE pin_no IN (${placeholders})
      `,
      chunk,
    );
    for (const row of rows) {
      const pin = text(row.pin_no);
      if (pin) map.set(norm(pin), row);
    }
  }
  return map;
}

function mapResultRow(
  row: ResultRow,
  paper: PaperRow | undefined,
  student: StudentRow | undefined,
) {
  const roll = text(row.studentRollNumber) ?? "";
  const subjectCode = text(row.subjectCode) ?? "";
  const inExamSubjects = Boolean(paper);

  return {
    id: Number(row.id),
    examId: Number(row.examId),
    examName: text(row.examName),
    examType: text(row.examType) ?? text(row.examTypeHeader),
    examStatus: text(row.examStatus),
    examCollege: text(row.examCollege),
    examCourse: text(row.examCourse),
    examBranch: text(row.examBranch),
    examBatch: text(row.examBatch),
    studentRollNumber: roll,
    studentName: text(row.studentName) ?? text(student?.student_name),
    student: student
      ? {
          id: Number(student.id),
          rollNumber: text(student.pin_no),
          admissionNo: student.admission_number,
          name: text(student.student_name),
          college: text(student.college),
          course: text(student.course),
          branch: text(student.branch),
          batch: text(student.batch),
        }
      : null,
    subjectCode,
    subjectName: text(row.subjectName) ?? text(paper?.name),
    subjectId: paper ? Number(paper.subjectId) : null,
    subjectType: text(paper?.type),
    inExamSubjects,
    grade: text(row.grade) ?? "",
    gradePoints: num(row.gradePoints),
    credits: num(row.credits) ?? 0,
    passed: Number(row.passed) === 1,
    result: resultLabel(row.passed),
    yearOfStudy: row.yearOfStudy,
    semester: row.semester,
    attemptNumber: Number(row.attemptNumber ?? 1),
    uploadId: row.uploadId != null ? Number(row.uploadId) : null,
    upload: row.uploadId
      ? {
          id: Number(row.uploadId),
          fileName: text(row.uploadFileName),
          uploadedBy: text(row.uploadUploadedBy),
          createdAt: text(row.uploadCreatedAt),
          rowCount: row.uploadRowCount != null ? Number(row.uploadRowCount) : null,
          studentCount: row.uploadStudentCount != null ? Number(row.uploadStudentCount) : null,
        }
      : null,
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

type MappedResult = ReturnType<typeof mapResultRow>;

function buildSummary(rows: MappedResult[]) {
  if (!rows.length) return null;

  const uniqueStudents = new Set(rows.map((r) => norm(r.studentRollNumber)).filter(Boolean));
  const passed = rows.filter((r) => r.passed).length;
  const failed = rows.length - passed;
  const gradeMap = new Map<string, number>();
  for (const row of rows) {
    const g = row.grade || "(blank)";
    gradeMap.set(g, (gradeMap.get(g) ?? 0) + 1);
  }

  return {
    totalRows: rows.length,
    uniqueStudents: uniqueStudents.size,
    passed,
    failed,
    passPercentage: rows.length ? Math.round((passed * 1000) / rows.length) / 10 : 0,
    gradeDistribution: [...gradeMap.entries()]
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count || a.grade.localeCompare(b.grade)),
  };
}

const RESULT_SELECT = `
  sr.id,
  sr.uploadId,
  sr.examId,
  sr.studentRollNumber,
  sr.studentName,
  sr.subjectCode,
  sr.subjectName,
  sr.grade,
  sr.passed,
  sr.credits,
  sr.gradePoints,
  sr.examType,
  sr.yearOfStudy,
  sr.semester,
  sr.attemptNumber,
  DATE_FORMAT(sr.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
  DATE_FORMAT(sr.updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt,
  e.name AS examName,
  e.type AS examTypeHeader,
  e.status AS examStatus,
  e.college AS examCollege,
  e.course AS examCourse,
  e.branch AS examBranch,
  e.batch AS examBatch,
  ru.fileName AS uploadFileName,
  ru.uploadedBy AS uploadUploadedBy,
  DATE_FORMAT(ru.createdAt, '%Y-%m-%d %H:%i:%s') AS uploadCreatedAt,
  ru.rowCount AS uploadRowCount,
  ru.studentCount AS uploadStudentCount
`;

async function queryResultRows(
  filters: ResultFilters,
): Promise<{ rows: MappedResult[]; total: number }> {
  const labels = await resolveStudentDbLabels(filters);
  const examIds = await matchingExamIds(filters, labels);
  const { where, params } = buildResultWhere(filters, examIds);

  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countRows = await queryExam<(RowDataPacket & { total: number })[]>(
    `
    SELECT COUNT(*) AS total
    FROM subject_results sr
    INNER JOIN exams e ON e.id = sr.examId
    LEFT JOIN result_uploads ru ON ru.id = sr.uploadId
    WHERE ${where.join(" AND ")}
    `,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const raw = await queryExam<ResultRow[]>(
    `
    SELECT ${RESULT_SELECT}
    FROM subject_results sr
    INNER JOIN exams e ON e.id = sr.examId
    LEFT JOIN result_uploads ru ON ru.id = sr.uploadId
    WHERE ${where.join(" AND ")}
    ORDER BY sr.examId DESC, sr.studentRollNumber, sr.subjectCode, sr.id
    LIMIT ? OFFSET ?
    `,
    [...params, limit, offset],
  );

  const examIdSet = [...new Set(raw.map((r) => Number(r.examId)))];
  const rolls = raw.map((r) => r.studentRollNumber);
  const [papers, students] = await Promise.all([
    loadExamPapers(examIdSet),
    loadStudentsByRoll(rolls),
  ]);

  const rows = raw.map((row) => {
    const paper = papers.get(`${Number(row.examId)}::${norm(row.subjectCode)}`);
    const student = students.get(norm(row.studentRollNumber));
    return mapResultRow(row, paper, student);
  });

  return { rows, total };
}

export async function listResultOptions() {
  const [exams, examTypes, resultExamTypes] = await Promise.all([
    queryExam<
      (RowDataPacket & {
        id: number;
        name: string;
        type: string | null;
        status: string | null;
        course: string | null;
        branch: string | null;
        batch: string | null;
      })[]
    >(
      `
      SELECT id, name, type, status, course, branch, batch
      FROM exams
      ORDER BY id DESC
      `,
    ),
    queryExam<(RowDataPacket & { type: string | null })[]>(
      `SELECT DISTINCT type FROM exams WHERE type IS NOT NULL AND TRIM(type) <> '' ORDER BY type`,
    ),
    queryExam<(RowDataPacket & { examType: string | null })[]>(
      `
      SELECT DISTINCT examType
      FROM subject_results
      WHERE examType IS NOT NULL AND TRIM(examType) <> ''
      ORDER BY examType
      `,
    ),
  ]);

  const typeSet = new Set<string>();
  for (const row of examTypes) {
    const t = text(row.type);
    if (t) typeSet.add(t);
  }
  for (const row of resultExamTypes) {
    const t = text(row.examType);
    if (t) typeSet.add(t);
  }

  return {
    readOnly: true as const,
    source: "examination_portal",
    exams: exams.map((row) => ({
      id: Number(row.id),
      name: row.name,
      type: text(row.type),
      status: text(row.status),
      course: text(row.course),
      branch: text(row.branch),
      batch: text(row.batch),
    })),
    examTypes: [...typeSet].sort((a, b) => a.localeCompare(b)),
    resultStatuses: [
      { value: "pass", label: "Pass" },
      { value: "fail", label: "Fail" },
    ],
  };
}

export async function listResults(filters: ResultFilters = {}) {
  const { rows, total } = await queryResultRows(filters);
  const summary = buildSummary(rows);

  return {
    readOnly: true as const,
    source: {
      results: "examination_portal.subject_results",
      uploads: "examination_portal.result_uploads",
      exams: "examination_portal.exams",
      subjects: "examination_portal.subjects",
      examSubjects: "examination_portal.exam_subjects",
      students: "student_database.students.pin_no",
    },
    count: rows.length,
    total,
    summary,
    data: rows,
  };
}

export async function getExamResults(examId: number) {
  if (!Number.isInteger(examId) || examId <= 0) return null;

  const examRows = await queryExam<ExamMetaRow[]>(
    `
    SELECT
      id, name, type, status, college, course, branch, batch,
      yearOfStudy, semester,
      DATE_FORMAT(publishedAt, '%Y-%m-%d %H:%i:%s') AS publishedAt
    FROM exams
    WHERE id = ?
    LIMIT 1
    `,
    [examId],
  );
  const exam = examRows[0];
  if (!exam) return null;

  const { rows, total } = await queryResultRows({ examId, limit: 2000, offset: 0 });

  const uploads = await queryExam<
    (RowDataPacket & {
      id: number;
      fileName: string | null;
      uploadedBy: string | null;
      rowCount: number;
      studentCount: number;
      createdAt: string | null;
    })[]
  >(
    `
    SELECT
      id, fileName, uploadedBy, rowCount, studentCount,
      DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
    FROM result_uploads
    WHERE examId = ?
    ORDER BY id DESC
    `,
    [examId],
  );

  return {
    readOnly: true as const,
    source: {
      results: "examination_portal.subject_results",
      uploads: "examination_portal.result_uploads",
      exam: "examination_portal.exams",
      subjects: "examination_portal.subjects",
      examSubjects: "examination_portal.exam_subjects",
      students: "student_database.students.pin_no",
    },
    exam: {
      id: Number(exam.id),
      name: exam.name,
      type: text(exam.type),
      status: text(exam.status),
      college: text(exam.college),
      course: text(exam.course),
      branch: text(exam.branch),
      batch: text(exam.batch),
      yearOfStudy: exam.yearOfStudy,
      semester: exam.semester,
      publishedAt: text(exam.publishedAt),
    },
    resultCount: total,
    summary: buildSummary(rows),
    uploads: uploads.map((row) => ({
      id: Number(row.id),
      fileName: text(row.fileName),
      uploadedBy: text(row.uploadedBy),
      rowCount: Number(row.rowCount ?? 0),
      studentCount: Number(row.studentCount ?? 0),
      createdAt: text(row.createdAt),
    })),
    data: rows,
  };
}

export async function getStudentResults(rollNumber: string) {
  const roll = rollNumber.trim();
  if (!roll) return null;

  const studentRows = await queryStudent<StudentRow[]>(
    `
    SELECT id, pin_no, admission_number, student_name, college, course, branch, batch
    FROM students
    WHERE pin_no = ? OR admission_number = ?
    LIMIT 1
    `,
    [roll, roll],
  );
  const student = studentRows[0] ?? null;
  const queryRoll = text(student?.pin_no) || roll;

  const raw = await queryExam<ResultRow[]>(
    `
    SELECT ${RESULT_SELECT}
    FROM subject_results sr
    INNER JOIN exams e ON e.id = sr.examId
    LEFT JOIN result_uploads ru ON ru.id = sr.uploadId
    WHERE sr.studentRollNumber = ?
    ORDER BY sr.examId DESC, sr.subjectCode, sr.id
    `,
    [queryRoll],
  );

  // Also try admission number if pin differed and no rows
  let resultRaw = raw;
  if (!resultRaw.length && student && text(student.admission_number) && text(student.admission_number) !== queryRoll) {
    resultRaw = await queryExam<ResultRow[]>(
      `
      SELECT ${RESULT_SELECT}
      FROM subject_results sr
      INNER JOIN exams e ON e.id = sr.examId
      LEFT JOIN result_uploads ru ON ru.id = sr.uploadId
      WHERE sr.studentRollNumber = ?
      ORDER BY sr.examId DESC, sr.subjectCode, sr.id
      `,
      [student.admission_number],
    );
  }

  const examIdSet = [...new Set(resultRaw.map((r) => Number(r.examId)))];
  const papers = await loadExamPapers(examIdSet);
  const studentMap = student
    ? new Map([[norm(text(student.pin_no) ?? ""), student]])
    : await loadStudentsByRoll(resultRaw.map((r) => r.studentRollNumber));

  const rows = resultRaw.map((row) => {
    const paper = papers.get(`${Number(row.examId)}::${norm(row.subjectCode)}`);
    const matched = studentMap.get(norm(row.studentRollNumber)) ?? student ?? undefined;
    return mapResultRow(row, paper, matched);
  });

  // Group by examination for student view
  const byExam = new Map<
    number,
    {
      examId: number;
      examName: string | null;
      examType: string | null;
      examStatus: string | null;
      yearOfStudy: number | null;
      semester: number | null;
      subjects: MappedResult[];
    }
  >();

  for (const row of rows) {
    const existing = byExam.get(row.examId);
    if (existing) {
      existing.subjects.push(row);
    } else {
      byExam.set(row.examId, {
        examId: row.examId,
        examName: row.examName,
        examType: row.examType,
        examStatus: row.examStatus,
        yearOfStudy: row.yearOfStudy,
        semester: row.semester,
        subjects: [row],
      });
    }
  }

  return {
    readOnly: true as const,
    source: {
      results: "examination_portal.subject_results",
      exams: "examination_portal.exams",
      subjects: "examination_portal.subjects",
      examSubjects: "examination_portal.exam_subjects",
      students: "student_database.students.pin_no",
    },
    student: student
      ? {
          id: Number(student.id),
          rollNumber: text(student.pin_no),
          admissionNo: student.admission_number,
          name: text(student.student_name),
          college: text(student.college),
          course: text(student.course),
          branch: text(student.branch),
          batch: text(student.batch),
        }
      : {
          id: null,
          rollNumber: queryRoll,
          admissionNo: null,
          name: rows[0]?.studentName ?? null,
          college: null,
          course: null,
          branch: null,
          batch: null,
        },
    resultCount: rows.length,
    summary: buildSummary(rows),
    examinations: [...byExam.values()],
    data: rows,
  };
}
