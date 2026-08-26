import type { RowDataPacket } from "mysql2";
import { executeStudent, queryStudent } from "../db/pools.js";

type CourseRow = RowDataPacket & {
  id: number;
  name: string;
  total_years: number | null;
  semesters_per_year: number | null;
  year_semester_config: unknown;
};

type YearRow = RowDataPacket & {
  id: number;
  year_label: string;
};

type SemesterRow = RowDataPacket & {
  id: number;
  college_id: number | null;
  course_id: number;
  academic_year_id: number;
  year_of_study: number;
  batch: string | null;
  semester_number: number;
  start_date: string | null;
  end_date: string | null;
  year_label: string | null;
};

type YearSemesterConfigItem = { year: number; semesters: number };

function parseYearSemesterConfig(raw: unknown): YearSemesterConfigItem[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const year = Number((item as { year?: unknown }).year);
      const semesters = Number((item as { semesters?: unknown }).semesters);
      if (!Number.isFinite(year) || !Number.isFinite(semesters) || year < 1 || semesters < 1) {
        return null;
      }
      return { year, semesters };
    })
    .filter((item): item is YearSemesterConfigItem => item != null);
}

function yearSemSlots(course: CourseRow): Array<{ year: number; semester: number }> {
  const config = parseYearSemesterConfig(course.year_semester_config);
  if (config.length > 0) {
    const slots: Array<{ year: number; semester: number }> = [];
    for (const item of config) {
      for (let semester = 1; semester <= item.semesters; semester += 1) {
        slots.push({ year: item.year, semester });
      }
    }
    return slots;
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

function sessionLabelFor(batch: string, yearOfStudy: number): string {
  const batchYear = Number(batch);
  if (!Number.isFinite(batchYear)) return "";
  const start = batchYear + yearOfStudy - 1;
  return `${start}-${start + 1}`;
}

function preferSemester(
  rows: SemesterRow[],
  collegeId: number,
  year: number,
  semester: number,
): SemesterRow | null {
  const matches = rows.filter(
    (row) => row.year_of_study === year && row.semester_number === semester,
  );
  if (matches.length === 0) return null;
  const collegeScoped = matches.find((row) => row.college_id === collegeId);
  if (collegeScoped) return collegeScoped;
  const programScoped = matches.find((row) => row.college_id == null);
  return programScoped ?? matches[0] ?? null;
}

async function ensureAcademicYearId(yearLabel: string): Promise<number> {
  const existing = await queryStudent<YearRow[]>(
    `SELECT id, year_label FROM academic_years WHERE year_label = ? LIMIT 1`,
    [yearLabel],
  );
  if (existing[0]) return Number(existing[0].id);

  const inserted = await executeStudent(
    `INSERT INTO academic_years (year_label, start_date, end_date, is_active)
     VALUES (?, NULL, NULL, 1)`,
    [yearLabel],
  );
  return Number(inserted.insertId);
}

export async function listSemesterDateBatches(collegeId: number, courseId: number) {
  const rows = await queryStudent<(RowDataPacket & { batch: string })[]>(
    `
    SELECT DISTINCT TRIM(batch) AS batch
    FROM students
    WHERE college_id = ?
      AND course_id = ?
      AND batch IS NOT NULL
      AND TRIM(batch) <> ''
    ORDER BY batch DESC
    `,
    [collegeId, courseId],
  );
  const fromStudents = rows.map((row) => row.batch);

  const fromSemesters = await queryStudent<(RowDataPacket & { batch: string })[]>(
    `
    SELECT DISTINCT TRIM(batch) AS batch
    FROM semesters
    WHERE course_id = ?
      AND (college_id = ? OR college_id IS NULL)
      AND batch IS NOT NULL
      AND TRIM(batch) <> ''
    ORDER BY batch DESC
    `,
    [courseId, collegeId],
  );

  return Array.from(
    new Set([...fromStudents, ...fromSemesters.map((row) => row.batch)].filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));
}

export async function getSemesterDatesGrid(input: {
  collegeId: number;
  courseId: number;
  batch: string;
}) {
  const courseRows = await queryStudent<CourseRow[]>(
    `SELECT id, name, total_years, semesters_per_year, year_semester_config
     FROM courses WHERE id = ? LIMIT 1`,
    [input.courseId],
  );
  const course = courseRows[0];
  if (!course) {
    throw new Error("Course not found in Student Database");
  }

  const slots = yearSemSlots(course);
  const semesterRows = await queryStudent<SemesterRow[]>(
    `
    SELECT
      sem.id,
      sem.college_id,
      sem.course_id,
      sem.academic_year_id,
      sem.year_of_study,
      sem.batch,
      sem.semester_number,
      DATE_FORMAT(sem.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(sem.end_date, '%Y-%m-%d') AS end_date,
      ay.year_label
    FROM semesters sem
    LEFT JOIN academic_years ay ON ay.id = sem.academic_year_id
    WHERE sem.course_id = ?
      AND TRIM(COALESCE(sem.batch, '')) COLLATE utf8mb4_unicode_ci
          = TRIM(?) COLLATE utf8mb4_unicode_ci
      AND (sem.college_id = ? OR sem.college_id IS NULL)
    ORDER BY sem.year_of_study, sem.semester_number, sem.college_id DESC
    `,
    [input.courseId, input.batch, input.collegeId],
  );

  const rows = slots.map((slot) => {
    const match = preferSemester(
      semesterRows,
      input.collegeId,
      slot.year,
      slot.semester,
    );
    const session =
      match?.year_label || sessionLabelFor(input.batch, slot.year) || "—";
    const saved = Boolean(match?.start_date && match?.end_date);
    return {
      key: `${slot.year}-${slot.semester}`,
      yearOfStudy: slot.year,
      semesterNumber: slot.semester,
      yearSemLabel: `${slot.year}-${slot.semester}`,
      session,
      semesterId: match?.id ?? null,
      collegeScoped: match?.college_id != null,
      startDate: match?.start_date ?? null,
      endDate: match?.end_date ?? null,
      status: saved ? "saved" : "missing",
    };
  });

  return {
    source: "student_database.semesters",
    collegeId: input.collegeId,
    courseId: input.courseId,
    courseName: course.name,
    batch: input.batch,
    note:
      "Semester dates are stored in Student Database at college / program level (All Branches). Branch chips mirror the Student DB UI; dates are not branch-specific.",
    rows,
  };
}

export async function upsertSemesterDates(input: {
  collegeId: number;
  courseId: number;
  batch: string;
  yearOfStudy: number;
  semesterNumber: number;
  startDate: string | null;
  endDate: string | null;
}) {
  if (
    input.startDate &&
    input.endDate &&
    input.startDate > input.endDate
  ) {
    throw new Error("Start date must be on or before end date");
  }

  const courseRows = await queryStudent<CourseRow[]>(
    `SELECT id, name, total_years, semesters_per_year, year_semester_config
     FROM courses WHERE id = ? LIMIT 1`,
    [input.courseId],
  );
  if (!courseRows[0]) throw new Error("Course not found in Student Database");

  const existing = await queryStudent<SemesterRow[]>(
    `
    SELECT
      sem.id,
      sem.college_id,
      sem.course_id,
      sem.academic_year_id,
      sem.year_of_study,
      sem.batch,
      sem.semester_number,
      DATE_FORMAT(sem.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(sem.end_date, '%Y-%m-%d') AS end_date,
      ay.year_label
    FROM semesters sem
    LEFT JOIN academic_years ay ON ay.id = sem.academic_year_id
    WHERE sem.course_id = ?
      AND TRIM(COALESCE(sem.batch, '')) COLLATE utf8mb4_unicode_ci
          = TRIM(?) COLLATE utf8mb4_unicode_ci
      AND sem.year_of_study = ?
      AND sem.semester_number = ?
      AND (sem.college_id = ? OR sem.college_id IS NULL)
    ORDER BY (sem.college_id <=> ?) DESC
    LIMIT 1
    `,
    [
      input.courseId,
      input.batch,
      input.yearOfStudy,
      input.semesterNumber,
      input.collegeId,
      input.collegeId,
    ],
  );

  const current = existing[0] ?? null;

  if (current && current.college_id === input.collegeId) {
    await executeStudent(
      `UPDATE semesters
       SET start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [input.startDate, input.endDate, current.id],
    );
    return { id: current.id, action: "updated" as const };
  }

  const session = sessionLabelFor(input.batch, input.yearOfStudy);
  if (!session) throw new Error("Invalid batch for academic session mapping");
  const academicYearId = await ensureAcademicYearId(session);

  const inserted = await executeStudent(
    `
    INSERT INTO semesters
      (college_id, course_id, academic_year_id, year_of_study, batch, semester_number, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.collegeId,
      input.courseId,
      academicYearId,
      input.yearOfStudy,
      input.batch,
      input.semesterNumber,
      input.startDate,
      input.endDate,
    ],
  );

  return { id: Number(inserted.insertId), action: "created" as const };
}
