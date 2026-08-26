import type { RowDataPacket } from "mysql2";
import { queryExam, queryStudent } from "../db/pools.js";

/**
 * Examinations are owned by EMS (examination_portal).
 * Academic Portal reads them only — no AP exam/application/subject masters.
 *
 * EMS: exams, exam_scopes, exam_subjects, exam_applications, exam_fee_records, regulations, subjects
 * Student DB: student identity / academic context (no cross-database FK)
 */

export type ExaminationFilters = {
  collegeId?: number;
  courseId?: number;
  branchId?: number;
  batch?: string;
  year?: number;
  semester?: number;
  regulationId?: number;
  status?: string;
  type?: string;
  q?: string;
};

type ExamRow = RowDataPacket & {
  id: number;
  name: string;
  type: string | null;
  status: string | null;
  regulationId: number | null;
  regulationCode: string | null;
  regulationName: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
  yearOfStudy: number | null;
  semester: number | null;
  examinationStartDate: string | null;
  examinationEndDate: string | null;
  applicationStartDate: string | null;
  applicationEndDate: string | null;
  publishedAt: string | null;
  packageFee: string | number | null;
  instructions: string | null;
  scopeCount?: number;
  subjectCount?: number;
  applicationCount?: number;
};

type ScopeRow = RowDataPacket & {
  id: number;
  examId: number;
  college: string | null;
  course: string | null;
  branch: string | null;
  branchId: number | null;
  batch: string | null;
  yearOfStudy: number | null;
  semester: number | null;
  section: string | null;
};

type SubjectRow = RowDataPacket & {
  id: number;
  examId: number;
  subjectId: number;
  fee: string | number | null;
  examDate: string | null;
  branch: string | null;
  session: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  section: string | null;
  code: string | null;
  name: string | null;
  type: string | null;
};

type ApplicationRow = RowDataPacket & {
  id: number;
  examId: number;
  examType: string | null;
  studentRollNumber: string | null;
  studentName: string | null;
  selectedSubjectIds: string | null;
  studentBranch: string | null;
  studentSection: string | null;
  submittedAt: string | null;
  feeRecordId: number | null;
  feeStatus: string | null;
  totalAmount: string | number | null;
  baseFee: string | number | null;
  lateFee: string | number | null;
};

type StudentRow = RowDataPacket & {
  id: number;
  admission_number: string;
  pin_no: string | null;
  student_name: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
  section: string | null;
  section_name: string | null;
  college_id: number | null;
  course_id: number | null;
  branch_id: number | null;
  current_year: number | null;
  current_semester: number | null;
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

function parseIdList(raw: string | null | undefined): number[] {
  const textValue = (raw ?? "").trim();
  if (!textValue) return [];
  try {
    const parsed = JSON.parse(textValue) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => Number(item)).filter((id) => Number.isFinite(id));
    }
  } catch {
    // fall through
  }
  return textValue
    .split(/[,;|]/)
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isFinite(id));
}

function like(value: string) {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function blank(value: string | null | undefined): boolean {
  return !text(value);
}

const EXAM_SELECT = `
  e.id,
  e.name,
  e.type,
  e.status,
  e.regulationId,
  r.code AS regulationCode,
  r.name AS regulationName,
  e.college,
  e.course,
  e.branch,
  e.batch,
  e.yearOfStudy,
  e.semester,
  DATE_FORMAT(e.examinationStartDate, '%Y-%m-%d') AS examinationStartDate,
  DATE_FORMAT(e.examinationEndDate, '%Y-%m-%d') AS examinationEndDate,
  DATE_FORMAT(e.applicationStartDate, '%Y-%m-%d') AS applicationStartDate,
  DATE_FORMAT(e.applicationEndDate, '%Y-%m-%d') AS applicationEndDate,
  DATE_FORMAT(e.publishedAt, '%Y-%m-%d %H:%i:%s') AS publishedAt,
  e.packageFee,
  e.instructions
`;

function mapExam(row: ExamRow) {
  return {
    id: Number(row.id),
    name: row.name,
    type: text(row.type),
    status: text(row.status),
    regulationId: row.regulationId,
    regulationCode: text(row.regulationCode),
    regulationName: text(row.regulationName),
    college: text(row.college),
    course: text(row.course),
    branch: text(row.branch),
    batch: text(row.batch),
    yearOfStudy: row.yearOfStudy,
    semester: row.semester,
    examinationStartDate: text(row.examinationStartDate),
    examinationEndDate: text(row.examinationEndDate),
    applicationStartDate: text(row.applicationStartDate),
    applicationEndDate: text(row.applicationEndDate),
    publishedAt: text(row.publishedAt),
    packageFee: num(row.packageFee),
    instructions: text(row.instructions),
    scopeCount: Number(row.scopeCount ?? 0),
    subjectCount: Number(row.subjectCount ?? 0),
    applicationCount: Number(row.applicationCount ?? 0),
  };
}

function mapScope(row: ScopeRow) {
  return {
    id: Number(row.id),
    examId: Number(row.examId),
    college: text(row.college),
    course: text(row.course),
    branch: text(row.branch),
    branchId: row.branchId,
    batch: text(row.batch),
    yearOfStudy: row.yearOfStudy,
    semester: row.semester,
    section: text(row.section),
  };
}

function mapPaper(row: SubjectRow) {
  return {
    id: Number(row.id),
    examId: Number(row.examId),
    subjectId: Number(row.subjectId),
    subjectCode: text(row.code),
    subjectName: text(row.name),
    type: text(row.type),
    examDate: text(row.examDate),
    fee: num(row.fee),
    branch: text(row.branch),
    session: text(row.session),
    startTime: text(row.startTime),
    endTime: text(row.endTime),
    durationMinutes: row.durationMinutes,
    section: text(row.section),
  };
}

type Paper = ReturnType<typeof mapPaper>;

function mapApplication(row: ApplicationRow, papersBySubjectId: Map<number, Paper[]>) {
  const selectedSubjectIds = parseIdList(row.selectedSubjectIds);
  const selectedSubjects = selectedSubjectIds.map((subjectId) => {
    const papers = papersBySubjectId.get(subjectId) ?? [];
    const paper = papers[0];
    return {
      subjectId,
      subjectCode: paper?.subjectCode ?? null,
      subjectName: paper?.subjectName ?? null,
      type: paper?.type ?? null,
      examDate: paper?.examDate ?? null,
      fee: paper?.fee ?? null,
    };
  });

  return {
    id: Number(row.id),
    examId: Number(row.examId),
    examType: text(row.examType),
    studentRollNumber: text(row.studentRollNumber),
    studentName: text(row.studentName),
    studentBranch: text(row.studentBranch),
    studentSection: text(row.studentSection),
    submittedAt: text(row.submittedAt),
    selectedSubjectIds,
    selectedSubjects,
    feeRecordId: row.feeRecordId,
    feeStatus: text(row.feeStatus),
    totalAmount: num(row.totalAmount),
    baseFee: num(row.baseFee),
    lateFee: num(row.lateFee),
  };
}

async function resolveStudentDbLabels(filters: ExaminationFilters) {
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

function buildListWhere(filters: ExaminationFilters, labels: Awaited<ReturnType<typeof resolveStudentDbLabels>>) {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.regulationId != null) {
    where.push("e.regulationId = ?");
    params.push(filters.regulationId);
  }
  if (filters.status) {
    where.push("LOWER(TRIM(e.status)) = ?");
    params.push(filters.status.trim().toLowerCase());
  }
  if (filters.type) {
    where.push("LOWER(TRIM(e.type)) = ?");
    params.push(filters.type.trim().toLowerCase());
  }
  if (filters.q) {
    const term = like(filters.q.trim());
    where.push(`(
      e.name LIKE ? OR e.course LIKE ? OR e.branch LIKE ? OR e.college LIKE ?
      OR r.code LIKE ? OR r.name LIKE ?
    )`);
    params.push(term, term, term, term, term, term);
  }

  const hasScopeFilter =
    Boolean(labels.collegeName) ||
    Boolean(labels.courseName) ||
    filters.branchId != null ||
    Boolean(labels.branchName) ||
    Boolean(filters.batch) ||
    filters.year != null ||
    filters.semester != null;

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
      } else {
        headerClauses.push("1=1");
      }
      scopeClauses.push(`(${branchParts.join(" OR ")})`);
    }
    if (filters.batch) {
      scopeClauses.push(`(TRIM(COALESCE(s.batch, '')) = '' OR TRIM(s.batch) = ?)`);
      scopeParams.push(filters.batch);
      headerClauses.push(`(TRIM(COALESCE(e.batch, '')) = '' OR TRIM(e.batch) = ?)`);
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

  return { where, params };
}

async function listExamsRaw(filters: ExaminationFilters) {
  const labels = await resolveStudentDbLabels(filters);
  const { where, params } = buildListWhere(filters, labels);
  return queryExam<ExamRow[]>(
    `
    SELECT
      ${EXAM_SELECT},
      (SELECT COUNT(*) FROM exam_scopes es WHERE es.examId = e.id) AS scopeCount,
      (SELECT COUNT(*) FROM exam_subjects esub WHERE esub.examId = e.id) AS subjectCount,
      (SELECT COUNT(*) FROM exam_applications ea WHERE ea.examId = e.id) AS applicationCount
    FROM exams e
    LEFT JOIN regulations r ON r.id = e.regulationId
    WHERE ${where.join(" AND ")}
    ORDER BY e.examinationStartDate DESC, e.id DESC
    LIMIT 200
    `,
    params,
  );
}

async function loadExam(id: number): Promise<ExamRow | null> {
  const rows = await queryExam<ExamRow[]>(
    `
    SELECT
      ${EXAM_SELECT},
      (SELECT COUNT(*) FROM exam_scopes es WHERE es.examId = e.id) AS scopeCount,
      (SELECT COUNT(*) FROM exam_subjects esub WHERE esub.examId = e.id) AS subjectCount,
      (SELECT COUNT(*) FROM exam_applications ea WHERE ea.examId = e.id) AS applicationCount
    FROM exams e
    LEFT JOIN regulations r ON r.id = e.regulationId
    WHERE e.id = ?
    LIMIT 1
    `,
    [id],
  );
  return rows[0] ?? null;
}

async function loadScopes(examIds: number[]): Promise<ScopeRow[]> {
  if (!examIds.length) return [];
  const placeholders = examIds.map(() => "?").join(",");
  return queryExam<ScopeRow[]>(
    `
    SELECT id, examId, college, course, branch, branchId, batch, yearOfStudy, semester, section
    FROM exam_scopes
    WHERE examId IN (${placeholders})
    ORDER BY examId, course, branch, batch, yearOfStudy, semester, id
    `,
    examIds,
  );
}

async function loadPapers(examIds: number[]): Promise<SubjectRow[]> {
  if (!examIds.length) return [];
  const placeholders = examIds.map(() => "?").join(",");
  return queryExam<SubjectRow[]>(
    `
    SELECT
      es.id,
      es.examId,
      es.subjectId,
      es.fee,
      DATE_FORMAT(es.examDate, '%Y-%m-%d') AS examDate,
      es.branch,
      es.session,
      es.startTime,
      es.endTime,
      es.durationMinutes,
      es.section,
      s.code,
      s.name,
      s.type
    FROM exam_subjects es
    LEFT JOIN subjects s ON s.id = es.subjectId
    WHERE es.examId IN (${placeholders})
    ORDER BY es.examId, es.examDate, s.code, es.id
    `,
    examIds,
  );
}

async function loadApplications(examIds: number[]): Promise<ApplicationRow[]> {
  if (!examIds.length) return [];
  const placeholders = examIds.map(() => "?").join(",");
  return queryExam<ApplicationRow[]>(
    `
    SELECT
      a.id,
      a.examId,
      a.examType,
      a.studentRollNumber,
      a.studentName,
      a.selectedSubjectIds,
      a.studentBranch,
      a.studentSection,
      DATE_FORMAT(a.submittedAt, '%Y-%m-%d %H:%i:%s') AS submittedAt,
      a.feeRecordId,
      f.status AS feeStatus,
      f.totalAmount,
      f.baseFee,
      f.lateFee
    FROM exam_applications a
    LEFT JOIN exam_fee_records f ON f.id = a.feeRecordId
    WHERE a.examId IN (${placeholders})
    ORDER BY a.examId, a.submittedAt DESC, a.id DESC
    `,
    examIds,
  );
}

async function loadMissingSubjects(subjectIds: number[]): Promise<Map<number, Paper>> {
  const map = new Map<number, Paper>();
  if (!subjectIds.length) return map;
  const placeholders = subjectIds.map(() => "?").join(",");
  const rows = await queryExam<
    (RowDataPacket & { id: number; code: string | null; name: string | null; type: string | null })[]
  >(
    `SELECT id, code, name, type FROM subjects WHERE id IN (${placeholders})`,
    subjectIds,
  );
  for (const row of rows) {
    map.set(Number(row.id), {
      id: 0,
      examId: 0,
      subjectId: Number(row.id),
      subjectCode: text(row.code),
      subjectName: text(row.name),
      type: text(row.type),
      examDate: null,
      fee: null,
      branch: null,
      session: null,
      startTime: null,
      endTime: null,
      durationMinutes: null,
      section: null,
    });
  }
  return map;
}

function papersBySubject(papers: Paper[]) {
  const map = new Map<number, Paper[]>();
  for (const paper of papers) {
    const list = map.get(paper.subjectId) ?? [];
    list.push(paper);
    map.set(paper.subjectId, list);
  }
  return map;
}

async function hydrateApplications(rows: ApplicationRow[], papers: Paper[]) {
  const bySubject = papersBySubject(papers);
  const known = new Set(bySubject.keys());
  const missingIds = new Set<number>();
  for (const row of rows) {
    for (const id of parseIdList(row.selectedSubjectIds)) {
      if (!known.has(id)) missingIds.add(id);
    }
  }
  const missing = await loadMissingSubjects([...missingIds]);
  for (const [id, paper] of missing) {
    bySubject.set(id, [paper]);
  }
  return rows.map((row) => mapApplication(row, bySubject));
}

export async function listExaminationOptions() {
  const [regulations, statuses, types] = await Promise.all([
    queryExam<(RowDataPacket & { id: number; code: string; name: string; status: string | null })[]>(
      `SELECT id, code, name, status FROM regulations ORDER BY code`,
    ),
    queryExam<(RowDataPacket & { status: string | null })[]>(
      `SELECT DISTINCT status FROM exams WHERE status IS NOT NULL AND TRIM(status) <> '' ORDER BY status`,
    ),
    queryExam<(RowDataPacket & { type: string | null })[]>(
      `SELECT DISTINCT type FROM exams WHERE type IS NOT NULL AND TRIM(type) <> '' ORDER BY type`,
    ),
  ]);

  return {
    source: "examination_portal",
    regulations: regulations.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      status: text(row.status),
    })),
    statuses: statuses.map((row) => String(row.status).trim()),
    types: types.map((row) => String(row.type).trim()),
  };
}

export async function listExaminations(filters: ExaminationFilters) {
  const rows = await listExamsRaw(filters);
  return {
    readOnly: true,
    source: {
      exams: "examination_portal.exams",
      scopes: "examination_portal.exam_scopes",
      subjects: "examination_portal.exam_subjects",
      applications: "examination_portal.exam_applications",
    },
    count: rows.length,
    data: rows.map(mapExam),
  };
}

export async function getExaminationDetail(id: number) {
  const exam = await loadExam(id);
  if (!exam) return null;

  const [scopeRows, paperRows, applicationRows] = await Promise.all([
    loadScopes([id]),
    loadPapers([id]),
    loadApplications([id]),
  ]);

  const papers = paperRows.map(mapPaper);
  const applications = await hydrateApplications(applicationRows, papers);

  return {
    readOnly: true,
    source: {
      exam: "examination_portal.exams",
      regulation: "examination_portal.regulations",
      scopes: "examination_portal.exam_scopes",
      subjects: "examination_portal.exam_subjects",
      applications: "examination_portal.exam_applications",
      fees: "examination_portal.exam_fee_records",
    },
    exam: mapExam(exam),
    scopes: scopeRows.map(mapScope),
    subjects: papers,
    applications,
  };
}

export async function listExaminationScopes(id: number) {
  const exam = await loadExam(id);
  if (!exam) return null;
  const rows = await loadScopes([id]);
  return {
    examId: id,
    source: "examination_portal.exam_scopes",
    count: rows.length,
    data: rows.map(mapScope),
  };
}

export async function listExaminationSubjects(id: number) {
  const exam = await loadExam(id);
  if (!exam) return null;
  const rows = await loadPapers([id]);
  return {
    examId: id,
    source: "examination_portal.exam_subjects",
    count: rows.length,
    data: rows.map(mapPaper),
  };
}

export async function listExaminationApplications(id: number) {
  const exam = await loadExam(id);
  if (!exam) return null;
  const [paperRows, applicationRows] = await Promise.all([
    loadPapers([id]),
    loadApplications([id]),
  ]);
  const data = await hydrateApplications(applicationRows, paperRows.map(mapPaper));
  return {
    examId: id,
    source: "examination_portal.exam_applications",
    count: data.length,
    data,
  };
}

function scopeMatchesStudent(
  scope: ReturnType<typeof mapScope>,
  student: {
    college: string | null;
    course: string | null;
    branch: string | null;
    branchId: number | null;
    batch: string | null;
    year: number | null;
    semester: number | null;
    section: string | null;
  },
) {
  if (!blank(scope.college) && norm(scope.college) !== norm(student.college)) return false;
  if (!blank(scope.course) && norm(scope.course) !== norm(student.course)) return false;
  if (scope.branchId != null && student.branchId != null) {
    if (scope.branchId !== student.branchId && norm(scope.branch) !== norm(student.branch)) {
      return false;
    }
  } else if (!blank(scope.branch) && norm(scope.branch) !== norm(student.branch)) {
    return false;
  }
  if (!blank(scope.batch) && text(scope.batch) !== text(student.batch)) return false;
  if (scope.yearOfStudy != null && student.year != null && scope.yearOfStudy !== student.year) {
    return false;
  }
  if (scope.semester != null && student.semester != null && scope.semester !== student.semester) {
    return false;
  }
  if (!blank(scope.section) && student.section && norm(scope.section) !== norm(student.section)) {
    return false;
  }
  return true;
}

async function findStudent(input: { studentId?: number; rollNumber?: string }) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.studentId != null) {
    clauses.push("s.id = ?");
    params.push(input.studentId);
  }
  if (input.rollNumber) {
    clauses.push("s.pin_no = ? OR s.admission_number = ?");
    params.push(input.rollNumber, input.rollNumber);
  }
  if (!clauses.length) return null;

  const rows = await queryStudent<StudentRow[]>(
    `
    SELECT
      s.id,
      s.admission_number,
      s.pin_no,
      s.student_name,
      s.college,
      s.course,
      s.branch,
      s.batch,
      s.section,
      ss.section_name,
      s.college_id,
      s.course_id,
      s.branch_id,
      s.current_year,
      s.current_semester
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    WHERE ${clauses.join(" OR ")}
    LIMIT 1
    `,
    params,
  );
  return rows[0] ?? null;
}

export async function getStudentExaminations(input: {
  studentId?: number;
  rollNumber?: string;
}) {
  const row = await findStudent(input);
  if (!row) return null;

  const student = {
    id: Number(row.id),
    name: text(row.student_name),
    admissionNo: row.admission_number,
    rollNumber: text(row.pin_no),
    college: text(row.college),
    course: text(row.course),
    branch: text(row.branch),
    batch: text(row.batch),
    year: row.current_year,
    semester: row.current_semester,
    section: text(row.section_name) || text(row.section),
    collegeId: row.college_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    source: "student_database.students" as const,
  };

  const [examRows, allScopes] = await Promise.all([
    listExamsRaw({}),
    queryExam<ScopeRow[]>(
      `
      SELECT id, examId, college, course, branch, branchId, batch, yearOfStudy, semester, section
      FROM exam_scopes
      ORDER BY examId, id
      `,
    ),
  ]);

  const scopesByExam = new Map<number, ReturnType<typeof mapScope>[]>();
  for (const scope of allScopes.map(mapScope)) {
    const list = scopesByExam.get(scope.examId) ?? [];
    list.push(scope);
    scopesByExam.set(scope.examId, list);
  }

  const eligible = examRows.map(mapExam).filter((exam) => {
    const scopes = scopesByExam.get(exam.id) ?? [];
    if (scopes.length) {
      return scopes.some((scope) =>
        scopeMatchesStudent(scope, {
          college: student.college,
          course: student.course,
          branch: student.branch,
          branchId: student.branchId,
          batch: student.batch,
          year: student.year,
          semester: student.semester,
          section: student.section,
        }),
      );
    }
    return scopeMatchesStudent(
      {
        id: 0,
        examId: exam.id,
        college: exam.college,
        course: exam.course,
        branch: exam.branch,
        branchId: null,
        batch: exam.batch,
        yearOfStudy: exam.yearOfStudy,
        semester: exam.semester,
        section: null,
      },
      {
        college: student.college,
        course: student.course,
        branch: student.branch,
        branchId: student.branchId,
        batch: student.batch,
        year: student.year,
        semester: student.semester,
        section: student.section,
      },
    );
  });

  const rollKeys = [student.rollNumber, student.admissionNo].filter(Boolean) as string[];
  let registered: Awaited<ReturnType<typeof hydrateApplications>> = [];
  if (rollKeys.length) {
    const placeholders = rollKeys.map(() => "?").join(",");
    const applicationRows = await queryExam<ApplicationRow[]>(
      `
      SELECT
        a.id,
        a.examId,
        a.examType,
        a.studentRollNumber,
        a.studentName,
        a.selectedSubjectIds,
        a.studentBranch,
        a.studentSection,
        DATE_FORMAT(a.submittedAt, '%Y-%m-%d %H:%i:%s') AS submittedAt,
        a.feeRecordId,
        f.status AS feeStatus,
        f.totalAmount,
        f.baseFee,
        f.lateFee
      FROM exam_applications a
      LEFT JOIN exam_fee_records f ON f.id = a.feeRecordId
      WHERE a.studentRollNumber IN (${placeholders})
      ORDER BY a.submittedAt DESC, a.id DESC
      `,
      rollKeys,
    );
    const examIds = [...new Set(applicationRows.map((row) => Number(row.examId)))];
    const papers = (await loadPapers(examIds)).map(mapPaper);
    registered = await hydrateApplications(applicationRows, papers);
  }

  const examsById = new Map(examRows.map((row) => [Number(row.id), mapExam(row)]));
  const applications = registered.map((application) => ({
    ...application,
    exam: examsById.get(application.examId) ?? null,
  }));

  return {
    readOnly: true,
    source: {
      student: "student_database.students",
      eligibility: "examination_portal.exam_scopes",
      applications: "examination_portal.exam_applications",
    },
    student,
    eligibleExams: eligible,
    applications,
  };
}
