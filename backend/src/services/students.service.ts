import type { RowDataPacket } from "mysql2";
import { queryStudent } from "../db/pools.js";
import { resolveSemesterWindow } from "./student-academic-dates.service.js";

type StudentListRow = RowDataPacket & {
  id: number;
  admission_number: string;
  pin_no: string | null;
  student_name: string | null;
  student_photo: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  college_id: number | null;
  course_id: number | null;
  current_year: number | null;
  current_semester: number | null;
  batch: string | null;
  section: string | null;
  section_name: string | null;
  student_status: string | null;
  attendance_pct: number | null;
};

type StudentCoreRow = RowDataPacket & {
  id: number;
  admission_number: string;
  admission_no: string | null;
  pin_no: string | null;
  student_name: string | null;
  student_photo: string | null;
  dob: string | null;
  gender: string | null;
  email: string | null;
  student_mobile: string | null;
  father_name: string | null;
  parent_mobile1: string | null;
  parent_mobile2: string | null;
  preferred_mobile_number: string | null;
  student_address: string | null;
  city_village: string | null;
  mandal_name: string | null;
  district: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
  section: string | null;
  section_name: string | null;
  college_id: number | null;
  course_id: number | null;
  current_year: number | null;
  current_semester: number | null;
  stud_type: string | null;
  student_status: string | null;
  scholar_status: string | null;
  admission_date: string | null;
  previous_college: string | null;
  certificates_status: string | null;
  fee_status: string | null;
  registration_status: string | null;
};

type AttendanceAggRow = RowDataPacket & {
  attendance_pct: number | null;
  present_count: number | null;
  absent_count: number | null;
  working_days: number | null;
};

type CourseSlotRow = RowDataPacket & {
  id: number;
  total_years: number | null;
  semesters_per_year: number | null;
  year_semester_config: unknown;
};

type DatedSemesterRow = RowDataPacket & {
  id: number;
  college_id: number | null;
  year_of_study: number;
  semester_number: number;
  start_date: string | null;
  end_date: string | null;
  updated_at: Date | string | null;
};

export type AttendanceSemesterOption = {
  key: string;
  yearOfStudy: number;
  semesterNumber: number;
  yearSemLabel: string;
  startDate: string | null;
  endDate: string | null;
  hasDates: boolean;
  isCurrent: boolean;
  label: string;
};

export type StudentAttendanceSnapshot = {
  attendance: number;
  present: number;
  absent: number;
  workingDays: number;
  risk: "High" | "Medium" | "Low";
  attendancePeriod: AttendancePeriod;
};

function text(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    return raw ? raw.slice(0, 10) : null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function riskFromAttendance(attendance: number): "High" | "Medium" | "Low" {
  if (attendance < 65) return "High";
  if (attendance < 75) return "Medium";
  return "Low";
}

/** Align batch string compares across tables with different collations. */
const BATCH_EQ_PARAM = `TRIM(COALESCE(sem.batch, '')) COLLATE utf8mb4_unicode_ci = TRIM(COALESCE(?, '')) COLLATE utf8mb4_unicode_ci`;
const BATCH_EMPTY = `TRIM(COALESCE(sem.batch, '')) COLLATE utf8mb4_unicode_ci = '' COLLATE utf8mb4_unicode_ci`;

/**
 * Prefer student_sections.section_name, then students.section.
 * Those columns use different collations (unicode_ci vs 0900_ai_ci);
 * COALESCE without an explicit COLLATE falls back to utf8mb4_bin and
 * then fails when compared to a unicode_ci bound parameter.
 */
const SECTION_EQ_PARAM = `TRIM(COALESCE(
  ss.section_name COLLATE utf8mb4_unicode_ci,
  s.section COLLATE utf8mb4_unicode_ci,
  '' COLLATE utf8mb4_unicode_ci
)) = TRIM(?) COLLATE utf8mb4_unicode_ci`;

export type AttendancePeriod = {
  source: "semester" | "fallback_90_days";
  /** Actual academic semester start from student_database.semesters */
  startDate: string | null;
  /** Actual academic semester end from student_database.semesters */
  endDate: string | null;
  /** End bound used for attendance calc (min of semester end and today) */
  attendanceEndDate: string | null;
  yearOfStudy: number | null;
  semesterNumber: number | null;
  yearSemLabel: string | null;
  semesterId: number | null;
  label: string;
};

function formatDisplayDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function yearSemRank(year: number, semester: number) {
  return year * 100 + semester;
}

function parseCourseSlots(course: CourseSlotRow): Array<{ year: number; semester: number }> {
  let parsed: unknown = course.year_semester_config;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    const slots: Array<{ year: number; semester: number }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const year = Number((item as { year?: unknown }).year);
      const semesters = Number((item as { semesters?: unknown }).semesters);
      if (!Number.isFinite(year) || !Number.isFinite(semesters) || year < 1 || semesters < 1) {
        continue;
      }
      for (let semester = 1; semester <= semesters; semester += 1) {
        slots.push({ year, semester });
      }
    }
    if (slots.length > 0) return slots;
  }

  const totalYears = Math.max(1, Number(course.total_years ?? 4));
  const perYear = Math.max(1, Number(course.semesters_per_year ?? 2));
  const slots: Array<{ year: number; semester: number }> = [];
  for (let year = 1; year <= totalYears; year += 1) {
    for (let semester = 1; semester <= perYear; semester += 1) {
      slots.push({ year, semester });
    }
  }
  return slots;
}

function pickDatedSemester(
  rows: DatedSemesterRow[],
  collegeId: number | null,
  year: number,
  semester: number,
): DatedSemesterRow | null {
  const matches = rows.filter(
    (row) => row.year_of_study === year && row.semester_number === semester,
  );
  if (matches.length === 0) return null;
  if (collegeId != null) {
    const collegeScoped = matches.find((row) => row.college_id === collegeId);
    if (collegeScoped) return collegeScoped;
  }
  const programScoped = matches.find((row) => row.college_id == null);
  return programScoped ?? matches[0] ?? null;
}

async function loadAttendanceAggregate(
  studentId: string,
  startBound: string | null,
  endBound: string | null,
) {
  const attendanceRows = await queryStudent<AttendanceAggRow[]>(
    `
    SELECT
      ROUND(
        SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN ar.status IN ('present','absent') THEN 1 ELSE 0 END), 0),
        1
      ) AS attendance_pct,
      SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present_count,
      SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
      SUM(CASE WHEN ar.status IN ('present','absent') THEN 1 ELSE 0 END) AS working_days
    FROM attendance_records ar
    WHERE ar.student_id = ?
      AND ar.attendance_date >= COALESCE(?, DATE_SUB(CURDATE(), INTERVAL 90 DAY))
      AND ar.attendance_date <= COALESCE(?, CURDATE())
    `,
    [studentId, startBound, endBound],
  );

  const agg = attendanceRows[0];
  const attendance = Number(agg?.attendance_pct ?? 0);
  const present = Number(agg?.present_count ?? 0);
  const absent = Number(agg?.absent_count ?? 0);
  const workingDays = Number(agg?.working_days ?? 0);
  return {
    attendance,
    present,
    absent,
    workingDays,
    risk: riskFromAttendance(attendance),
  };
}

async function listAttendanceSemesterOptions(input: {
  collegeId: number | null;
  courseId: number | null;
  batch: string | null;
  currentYear: number | null;
  currentSemester: number | null;
}): Promise<AttendanceSemesterOption[]> {
  if (input.courseId == null || input.currentYear == null || input.currentSemester == null) {
    return [];
  }

  const courseRows = await queryStudent<CourseSlotRow[]>(
    `SELECT id, total_years, semesters_per_year, year_semester_config
     FROM courses WHERE id = ? LIMIT 1`,
    [input.courseId],
  );
  const course = courseRows[0];
  if (!course) return [];

  const currentRank = yearSemRank(input.currentYear, input.currentSemester);
  const slots = parseCourseSlots(course).filter(
    (slot) => yearSemRank(slot.year, slot.semester) <= currentRank,
  );

  const datedRows = await queryStudent<DatedSemesterRow[]>(
    `
    SELECT
      sem.id,
      sem.college_id,
      sem.year_of_study,
      sem.semester_number,
      DATE_FORMAT(sem.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(sem.end_date, '%Y-%m-%d') AS end_date,
      sem.updated_at
    FROM semesters sem
    WHERE sem.course_id = ?
      AND (sem.college_id IS NULL OR sem.college_id = ?)
      AND (
        sem.batch IS NULL
        OR ${BATCH_EMPTY}
        OR ${BATCH_EQ_PARAM}
      )
      AND sem.start_date IS NOT NULL
      AND sem.end_date IS NOT NULL
    ORDER BY
      (sem.college_id <=> ?) DESC,
      (${BATCH_EQ_PARAM}) DESC,
      sem.updated_at DESC
    `,
    [input.courseId, input.collegeId, input.batch, input.collegeId, input.batch],
  );

  return slots
    .map((slot) => {
      const match = pickDatedSemester(
        datedRows,
        input.collegeId,
        slot.year,
        slot.semester,
      );
      const startDate = toDateOnly(match?.start_date);
      const endDate = toDateOnly(match?.end_date);
      const hasDates = Boolean(startDate && endDate);
      const isCurrent =
        slot.year === input.currentYear && slot.semester === input.currentSemester;
      const yearSemLabel = `${slot.year}-${slot.semester}`;
      const startLabel = formatDisplayDate(startDate);
      const endLabel = formatDisplayDate(endDate);
      return {
        key: yearSemLabel,
        yearOfStudy: slot.year,
        semesterNumber: slot.semester,
        yearSemLabel,
        startDate,
        endDate,
        hasDates,
        isCurrent,
        label: hasDates
          ? `Year-Sem ${yearSemLabel} (${startLabel} to ${endLabel})${isCurrent ? " | Current" : ""}`
          : `Year-Sem ${yearSemLabel}${isCurrent ? " | Current" : ""} (dates missing)`,
      };
    })
    .reverse(); // newest / current first in dropdown
}

async function resolveAttendancePeriod(input: {
  collegeId: number | null;
  courseId: number | null;
  batch: string | null;
  year: number | null;
  semester: number | null;
}): Promise<AttendancePeriod> {
  if (input.courseId == null || input.year == null || input.semester == null) {
    return {
      source: "fallback_90_days",
      startDate: null,
      endDate: null,
      attendanceEndDate: null,
      yearOfStudy: null,
      semesterNumber: null,
      yearSemLabel: null,
      semesterId: null,
      label: "Last 90 days (semester dates unavailable)",
    };
  }

  const match = await resolveSemesterWindow({
    collegeId: input.collegeId,
    courseId: input.courseId,
    batch: input.batch,
    yearOfStudy: input.year,
    semesterNumber: input.semester,
  });

  if (!match) {
    return {
      source: "fallback_90_days",
      startDate: null,
      endDate: null,
      attendanceEndDate: null,
      yearOfStudy: input.year,
      semesterNumber: input.semester,
      yearSemLabel: `${input.year}-${input.semester}`,
      semesterId: null,
      label: "Last 90 days (semester dates unavailable)",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const attendanceEndDate = match.endDate < today ? match.endDate : today;
  const yearSemLabel = `${input.year}-${input.semester}`;
  const startLabel = formatDisplayDate(match.startDate);
  const endLabel = formatDisplayDate(match.endDate);

  return {
    source: "semester",
    startDate: match.startDate,
    endDate: match.endDate,
    attendanceEndDate,
    yearOfStudy: input.year,
    semesterNumber: input.semester,
    yearSemLabel,
    semesterId: match.semesterId,
    label: `Year-Sem ${yearSemLabel} (${startLabel} to ${endLabel})`,
  };
}

function mapListRow(row: StudentListRow & { has_photo?: number | boolean | null }) {
  const attendance = Number(row.attendance_pct ?? 0);
  return {
    id: String(row.id),
    name: text(row.student_name) ?? "Unknown",
    admissionNo: row.admission_number,
    rollNo: text(row.pin_no),
    // List responses omit base64 photos for speed; client loads via /students/:id/photo.
    photo: null as string | null,
    hasPhoto: Boolean(row.has_photo),
    course: text(row.course) ?? "—",
    college: text(row.college) ?? "—",
    branch: text(row.branch) ?? "—",
    year: row.current_year ?? null,
    semester: row.current_semester ?? null,
    batch: text(row.batch) ?? "—",
    section: text(row.section_name) || text(row.section) || "—",
    attendance,
    risk: riskFromAttendance(attendance),
    status: text(row.student_status) || "—",
  };
}

export type StudentListFilters = {
  q?: string;
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  batch?: string;
  year?: number;
  semester?: number;
  section?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type StudentListResult = {
  data: ReturnType<typeof mapListRow>[];
  total: number;
  limit: number;
  offset: number;
};

function buildStudentListWhere(input: StudentListFilters) {
  const query = (input.q ?? "").trim();
  const like = `%${query}%`;
  const where: string[] = [];
  const params: unknown[] = [];

  if (query) {
    where.push(`(
      s.admission_number LIKE ? OR
      s.student_name LIKE ? OR
      s.section LIKE ? OR
      ss.section_name LIKE ? OR
      s.branch LIKE ? OR
      s.course LIKE ? OR
      s.pin_no LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  if (input.collegeId != null) {
    where.push("s.college_id = ?");
    params.push(input.collegeId);
  } else if (input.collegeIds?.length) {
    where.push(`s.college_id IN (${input.collegeIds.map(() => "?").join(",")})`);
    params.push(...input.collegeIds);
  }
  if (input.courseId != null) {
    where.push("s.course_id = ?");
    params.push(input.courseId);
  }
  if (input.branchId != null) {
    where.push("s.branch_id = ?");
    params.push(input.branchId);
  } else if (input.branchIds?.length) {
    where.push(`s.branch_id IN (${input.branchIds.map(() => "?").join(",")})`);
    params.push(...input.branchIds);
  }
  if (input.batch) {
    where.push("TRIM(s.batch) = ?");
    params.push(input.batch);
  }
  if (input.year != null) {
    where.push("s.current_year = ?");
    params.push(input.year);
  }
  if (input.semester != null) {
    where.push("s.current_semester = ?");
    params.push(input.semester);
  }
  if (input.section) {
    where.push(`(${SECTION_EQ_PARAM})`);
    params.push(input.section);
  }
  if (input.status) {
    where.push(
      `TRIM(COALESCE(s.student_status, '')) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci`,
    );
    params.push(input.status);
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export async function listStudents(
  filters: StudentListFilters | string = {},
  limitArg = 50,
  offsetArg = 0,
): Promise<StudentListResult> {
  // Back-compat for older callers: listStudents(q, limit, offset)
  const input: StudentListFilters =
    typeof filters === "string"
      ? { q: filters, limit: limitArg, offset: offsetArg }
      : filters;

  const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50)));
  const offset = Math.max(0, Number(input.offset ?? 0));
  const { whereSql, params } = buildStudentListWhere(input);

  const [countRows, rows] = await Promise.all([
    queryStudent<(RowDataPacket & { total: number })[]>(
      `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM students s
      LEFT JOIN student_sections ss ON ss.student_id = s.id
      ${whereSql}
      `,
      params,
    ),
    queryStudent<StudentListRow[]>(
      `
      SELECT
        s.id,
        s.admission_number,
        s.pin_no,
        s.student_name,
        s.college,
        s.course,
        s.branch,
        s.college_id,
        s.course_id,
        s.current_year,
        s.current_semester,
        s.batch,
        s.section,
        ss.section_name,
        s.student_status,
        CASE
          WHEN s.student_photo IS NOT NULL AND TRIM(s.student_photo) <> '' THEN 1
          ELSE 0
        END AS has_photo
      FROM students s
      LEFT JOIN student_sections ss ON ss.student_id = s.id
      ${whereSql}
      ORDER BY s.updated_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    ),
  ]);

  const total = Number(countRows[0]?.total ?? 0);
  if (rows.length === 0) {
    return { data: [], total, limit, offset };
  }

  const attendanceByStudent = await loadListAttendanceByStudent(rows);
  return {
    data: rows.map((row) =>
      mapListRow({
        ...row,
        attendance_pct: attendanceByStudent.get(Number(row.id)) ?? 0,
      }),
    ),
    total,
    limit,
    offset,
  };
}

async function loadListAttendanceByStudent(rows: StudentListRow[]) {
  const attendanceByStudent = new Map<number, number>();
  type ScopeGroup = {
    key: string;
    collegeId: number | null;
    courseId: number | null;
    batch: string | null;
    year: number | null;
    semester: number | null;
    studentIds: number[];
  };

  const groups = new Map<string, ScopeGroup>();
  for (const row of rows) {
    const key = [
      row.college_id ?? "x",
      row.course_id ?? "x",
      text(row.batch) ?? "",
      row.current_year ?? "x",
      row.current_semester ?? "x",
    ].join(":");
    const existing = groups.get(key);
    if (existing) {
      existing.studentIds.push(Number(row.id));
    } else {
      groups.set(key, {
        key,
        collegeId: row.college_id,
        courseId: row.course_id,
        batch: row.batch,
        year: row.current_year,
        semester: row.current_semester,
        studentIds: [Number(row.id)],
      });
    }
  }

  await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      const period = await resolveAttendancePeriod({
        collegeId: group.collegeId,
        courseId: group.courseId,
        batch: group.batch,
        year: group.year,
        semester: group.semester,
      });
      const startBound =
        period.source === "semester" && period.startDate ? period.startDate : null;
      const endBound =
        period.source === "semester" && period.attendanceEndDate
          ? period.attendanceEndDate
          : null;

      const placeholders = group.studentIds.map(() => "?").join(", ");
      const aggRows = await queryStudent<
        (RowDataPacket & { student_id: number; attendance_pct: number | null })[]
      >(
        `
        SELECT
          ar.student_id,
          ROUND(
            SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN ar.status IN ('present','absent') THEN 1 ELSE 0 END), 0),
            1
          ) AS attendance_pct
        FROM attendance_records ar
        WHERE ar.student_id IN (${placeholders})
          AND ar.attendance_date >= COALESCE(?, DATE_SUB(CURDATE(), INTERVAL 90 DAY))
          AND ar.attendance_date <= COALESCE(?, CURDATE())
        GROUP BY ar.student_id
        `,
        [...group.studentIds, startBound, endBound],
      );

      for (const agg of aggRows) {
        attendanceByStudent.set(Number(agg.student_id), Number(agg.attendance_pct ?? 0));
      }
    }),
  );

  return attendanceByStudent;
}

export type StudentListStatsResult = {
  total: number;
  avgAttendance: number | null;
  below75: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
};

/**
 * Attendance / risk totals for the full filtered student cohort
 * (same filters as listStudents — not limited to a page of rows).
 */
export async function getStudentListStats(
  filters: StudentListFilters,
): Promise<StudentListStatsResult> {
  const { whereSql, params } = buildStudentListWhere(filters);

  const scopeRows = await queryStudent<
    (RowDataPacket & {
      id: number;
      college_id: number | null;
      course_id: number | null;
      batch: string | null;
      current_year: number | null;
      current_semester: number | null;
    })[]
  >(
    `
    SELECT
      s.id,
      s.college_id,
      s.course_id,
      s.batch,
      s.current_year,
      s.current_semester
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    ${whereSql}
    GROUP BY
      s.id,
      s.college_id,
      s.course_id,
      s.batch,
      s.current_year,
      s.current_semester
    `,
    params,
  );

  const total = scopeRows.length;
  if (total === 0) {
    return {
      total: 0,
      avgAttendance: null,
      below75: 0,
      highRisk: 0,
      mediumRisk: 0,
      lowRisk: 0,
    };
  }

  const rowsForAttendance = scopeRows.map(
    (row) =>
      ({
        id: row.id,
        admission_number: "",
        pin_no: null,
        student_name: null,
        student_photo: null,
        college: null,
        course: null,
        branch: null,
        college_id: row.college_id,
        course_id: row.course_id,
        current_year: row.current_year,
        current_semester: row.current_semester,
        batch: row.batch,
        section: null,
        section_name: null,
        student_status: null,
        attendance_pct: null,
      }) as StudentListRow,
  );

  const attendanceByStudent = await loadListAttendanceByStudent(rowsForAttendance);
  let sum = 0;
  let below75 = 0;
  let highRisk = 0;
  let mediumRisk = 0;
  let lowRisk = 0;

  for (const row of scopeRows) {
    const attendance = Number(attendanceByStudent.get(Number(row.id)) ?? 0);
    sum += attendance;
    const risk = riskFromAttendance(attendance);
    if (attendance < 75) below75 += 1;
    if (risk === "High") highRisk += 1;
    else if (risk === "Medium") mediumRisk += 1;
    else lowRisk += 1;
  }

  return {
    total,
    avgAttendance: Math.round((sum / total) * 10) / 10,
    below75,
    highRisk,
    mediumRisk,
    lowRisk,
  };
}

export async function listStudentStatuses() {
  const rows = await queryStudent<(RowDataPacket & { status: string })[]>(
    `
    SELECT DISTINCT TRIM(student_status) AS status
    FROM students
    WHERE student_status IS NOT NULL AND TRIM(student_status) <> ''
    ORDER BY status
    `,
  );
  return rows.map((row) => row.status).filter(Boolean);
}

export async function getStudentScope(id: string) {
  const rows = await queryStudent<
    (RowDataPacket & { college_id: number | null; branch_id: number | null })[]
  >(
    `
    SELECT college_id, branch_id
    FROM students
    WHERE id = ?
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    collegeId: row.college_id == null ? null : Number(row.college_id),
    branchId: row.branch_id == null ? null : Number(row.branch_id),
  };
}

export async function getStudentPhoto(id: string) {
  const rows = await queryStudent<(RowDataPacket & { student_photo: string | null })[]>(
    `
    SELECT student_photo
    FROM students
    WHERE id = ?
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: String(id), photo: text(row.student_photo) };
}

export async function getStudentAttendance(
  id: string,
  year?: number,
  semester?: number,
): Promise<StudentAttendanceSnapshot | null> {
  const rows = await queryStudent<StudentCoreRow[]>(
    `
    SELECT
      s.id,
      s.college_id,
      s.course_id,
      s.batch,
      s.current_year,
      s.current_semester
    FROM students s
    WHERE s.id = ?
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  const targetYear = year ?? row.current_year;
  const targetSemester = semester ?? row.current_semester;
  const period = await resolveAttendancePeriod({
    collegeId: row.college_id,
    courseId: row.course_id,
    batch: row.batch,
    year: targetYear,
    semester: targetSemester,
  });

  const startBound =
    period.source === "semester" && period.startDate ? period.startDate : null;
  const endBound =
    period.source === "semester" && period.attendanceEndDate
      ? period.attendanceEndDate
      : null;

  const stats = await loadAttendanceAggregate(String(row.id), startBound, endBound);
  return {
    ...stats,
    attendancePeriod: period,
  };
}

export async function getStudentById(id: string) {
  const rows = await queryStudent<StudentCoreRow[]>(
    `
    SELECT
      s.id,
      s.admission_number,
      s.admission_no,
      s.pin_no,
      s.student_name,
      s.student_photo,
      s.dob,
      s.gender,
      s.email,
      s.student_mobile,
      s.father_name,
      s.parent_mobile1,
      s.parent_mobile2,
      s.preferred_mobile_number,
      s.student_address,
      s.city_village,
      s.mandal_name,
      s.district,
      s.college,
      s.course,
      s.branch,
      s.batch,
      s.section,
      ss.section_name,
      s.college_id,
      s.course_id,
      s.current_year,
      s.current_semester,
      s.stud_type,
      s.student_status,
      s.scholar_status,
      s.admission_date,
      s.previous_college,
      s.certificates_status,
      s.fee_status,
      s.registration_status
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    WHERE s.id = ?
    LIMIT 1
    `,
    [id],
  );

  const row = rows[0];
  if (!row) return null;

  const [attendance, attendanceSemesters] = await Promise.all([
    getStudentAttendance(String(row.id), row.current_year ?? undefined, row.current_semester ?? undefined),
    listAttendanceSemesterOptions({
      collegeId: row.college_id,
      courseId: row.course_id,
      batch: row.batch,
      currentYear: row.current_year,
      currentSemester: row.current_semester,
    }),
  ]);

  const photo = text(row.student_photo);

  return {
    id: String(row.id),
    name: text(row.student_name) ?? "Unknown",
    admissionNo: row.admission_number,
    rollNo: text(row.pin_no),
    photo,
    status: text(row.student_status) || "Active",
    college: text(row.college),
    course: text(row.course),
    branch: text(row.branch),
    batch: text(row.batch),
    year: row.current_year ?? null,
    semester: row.current_semester ?? null,
    section: text(row.section_name) || text(row.section),
    admissionType: text(row.stud_type),
    admissionDate: text(row.admission_date),
    previousCollege: text(row.previous_college),
    scholarStatus: text(row.scholar_status),
    feeStatus: text(row.fee_status),
    registrationStatus: text(row.registration_status),
    certificatesStatus: text(row.certificates_status),
    dob: text(row.dob),
    gender: text(row.gender),
    email: text(row.email),
    mobile: text(row.student_mobile),
    fatherName: text(row.father_name),
    parentMobile1: text(row.parent_mobile1),
    parentMobile2: text(row.parent_mobile2),
    preferredMobile: text(row.preferred_mobile_number),
    address: text(row.student_address),
    cityVillage: text(row.city_village),
    mandal: text(row.mandal_name),
    district: text(row.district),
    attendance: attendance?.attendance ?? 0,
    present: attendance?.present ?? 0,
    absent: attendance?.absent ?? 0,
    workingDays: attendance?.workingDays ?? 0,
    risk: attendance?.risk ?? "Low",
    attendancePeriod: attendance?.attendancePeriod,
    attendanceSemesters,
  };
}
