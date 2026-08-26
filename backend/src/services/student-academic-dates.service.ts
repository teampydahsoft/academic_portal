import type { RowDataPacket } from "mysql2";
import { queryStudent } from "../db/pools.js";

/**
 * Student Database is the source of truth for:
 * - semester windows (`semesters.start_date` / `semesters.end_date`)
 * - declared holidays (`custom_holidays`)
 *
 * Do not use academic_years.start_date / end_date (currently NULL).
 * Do not use attendance_records as a calendar.
 */

export type SemesterWindowInput = {
  collegeId: number | null | undefined;
  courseId: number;
  batch?: string | null;
  yearOfStudy: number;
  semesterNumber: number;
};

export type SemesterWindow = {
  source: "student_database.semesters";
  semesterId: number;
  collegeId: number | null;
  courseId: number;
  academicYearId: number;
  academicYearLabel: string | null;
  batch: string | null;
  yearOfStudy: number;
  semesterNumber: number;
  startDate: string;
  endDate: string;
};

export type HolidayScope = {
  collegeId?: number | null;
  courseId?: number | null;
  branchId?: number | null;
  batch?: string | null;
  yearOfStudy?: number | null;
  semesterNumber?: number | null;
  collegeName?: string | null;
  courseName?: string | null;
  branchName?: string | null;
};

export type CustomHoliday = {
  id: number;
  holidayDate: string;
  title: string;
  description: string | null;
  targetCollege: string | null;
  targetBatch: string | null;
  targetCourse: string | null;
  targetBranch: string | null;
  targetYear: string | null;
  targetSemester: string | null;
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

type HolidayRow = RowDataPacket & {
  id: number;
  holiday_date: string;
  title: string;
  description: string | null;
  target_college: string | null;
  target_batch: string | null;
  target_course: string | null;
  target_branch: string | null;
  target_year: string | null;
  target_semester: string | null;
};

const BATCH_EQ = `TRIM(COALESCE(sem.batch, '')) COLLATE utf8mb4_unicode_ci = TRIM(COALESCE(?, '')) COLLATE utf8mb4_unicode_ci`;
const BATCH_EMPTY = `TRIM(COALESCE(sem.batch, '')) COLLATE utf8mb4_unicode_ci = '' COLLATE utf8mb4_unicode_ci`;

function toDateOnly(value: string | Date | null | undefined): string | null {
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

function parseTargetTokens(raw: string | null | undefined): string[] | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      const tokens = parsed.map((item) => String(item).trim()).filter(Boolean);
      return tokens.length ? tokens : null;
    }
    if (parsed != null && String(parsed).trim()) {
      return [String(parsed).trim()];
    }
  } catch {
    // not JSON — fall through to delimiter split
  }
  const tokens = text
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return tokens.length ? tokens : null;
}

function targetMatches(
  target: string | null | undefined,
  candidates: Array<string | number | null | undefined>,
): boolean {
  const tokens = parseTargetTokens(target);
  if (!tokens) return true;
  const normalized = new Set(tokens.map((t) => t.toLowerCase()));
  if (normalized.has("*") || normalized.has("all")) return true;
  return candidates.some((candidate) => {
    if (candidate == null) return false;
    const value = String(candidate).trim().toLowerCase();
    return value.length > 0 && normalized.has(value);
  });
}

function mapHoliday(row: HolidayRow): CustomHoliday {
  return {
    id: Number(row.id),
    holidayDate: toDateOnly(row.holiday_date) ?? String(row.holiday_date).slice(0, 10),
    title: row.title,
    description: row.description,
    targetCollege: row.target_college,
    targetBatch: row.target_batch,
    targetCourse: row.target_course,
    targetBranch: row.target_branch,
    targetYear: row.target_year,
    targetSemester: row.target_semester,
  };
}

/**
 * Empty / NULL target fields mean the holiday applies to every scope (all students).
 * Only non-empty target lists restrict the audience.
 */
export function holidayAppliesToScope(holiday: CustomHoliday, scope: HolidayScope): boolean {
  return (
    targetMatches(holiday.targetCollege, [scope.collegeId, scope.collegeName]) &&
    targetMatches(holiday.targetCourse, [scope.courseId, scope.courseName]) &&
    targetMatches(holiday.targetBranch, [scope.branchId, scope.branchName]) &&
    targetMatches(holiday.targetBatch, [scope.batch]) &&
    targetMatches(holiday.targetYear, [scope.yearOfStudy]) &&
    targetMatches(holiday.targetSemester, [scope.semesterNumber])
  );
}

/**
 * Best-matching Student DB semester window for a college / course / batch / year / semester.
 * Prefers college-scoped rows, then exact batch, then blank/null batch.
 */
export async function resolveSemesterWindow(
  input: SemesterWindowInput,
): Promise<SemesterWindow | null> {
  const collegeId = input.collegeId ?? null;
  const batch = input.batch?.trim() || null;

  const rows = await queryStudent<SemesterRow[]>(
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
      AND sem.year_of_study = ?
      AND sem.semester_number = ?
      AND sem.start_date IS NOT NULL
      AND sem.end_date IS NOT NULL
      AND (sem.college_id IS NULL OR sem.college_id = ?)
      AND (
        sem.batch IS NULL
        OR ${BATCH_EMPTY}
        OR ${BATCH_EQ}
      )
    ORDER BY
      (sem.college_id <=> ?) DESC,
      (${BATCH_EQ}) DESC,
      sem.updated_at DESC
    LIMIT 1
    `,
    [input.courseId, input.yearOfStudy, input.semesterNumber, collegeId, batch, collegeId, batch],
  );

  const row = rows[0];
  const startDate = toDateOnly(row?.start_date);
  const endDate = toDateOnly(row?.end_date);
  if (!row || !startDate || !endDate) return null;

  return {
    source: "student_database.semesters",
    semesterId: Number(row.id),
    collegeId: row.college_id,
    courseId: Number(row.course_id),
    academicYearId: Number(row.academic_year_id),
    academicYearLabel: row.year_label,
    batch: row.batch,
    yearOfStudy: Number(row.year_of_study),
    semesterNumber: Number(row.semester_number),
    startDate,
    endDate,
  };
}

export async function resolveHolidayScopeNames(scope: HolidayScope): Promise<HolidayScope> {
  const next: HolidayScope = { ...scope };

  if (scope.collegeId && !scope.collegeName) {
    const rows = await queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM colleges WHERE id = ? LIMIT 1`,
      [scope.collegeId],
    );
    next.collegeName = rows[0]?.name ?? null;
  }
  if (scope.courseId && !scope.courseName) {
    const rows = await queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM courses WHERE id = ? LIMIT 1`,
      [scope.courseId],
    );
    next.courseName = rows[0]?.name ?? null;
  }
  if (scope.branchId && !scope.branchName) {
    const rows = await queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM course_branches WHERE id = ? LIMIT 1`,
      [scope.branchId],
    );
    next.branchName = rows[0]?.name ?? null;
  }

  return next;
}

export async function listCustomHolidays(input: {
  startDate: string;
  endDate: string;
  scope?: HolidayScope;
}): Promise<CustomHoliday[]> {
  const startDate = toDateOnly(input.startDate);
  const endDate = toDateOnly(input.endDate);
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required");
  }
  if (endDate < startDate) {
    throw new Error("endDate must be on or after startDate");
  }

  const rows = await queryStudent<HolidayRow[]>(
    `
    SELECT
      id,
      DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date,
      title,
      description,
      target_college,
      target_batch,
      target_course,
      target_branch,
      target_year,
      target_semester
    FROM custom_holidays
    WHERE holiday_date >= ?
      AND holiday_date <= ?
    ORDER BY holiday_date, id
    `,
    [startDate, endDate],
  );

  const mapped = rows.map(mapHoliday);
  if (!input.scope) return mapped;

  const scope = await resolveHolidayScopeNames(input.scope);
  return mapped.filter((holiday) => holidayAppliesToScope(holiday, scope));
}

export async function holidayDateSet(input: {
  startDate: string;
  endDate: string;
  scope?: HolidayScope;
}): Promise<Set<string>> {
  const holidays = await listCustomHolidays(input);
  return new Set(holidays.map((h) => h.holidayDate));
}

export function isIsoDate(value: string | undefined | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function partsFromIso(isoDate: string): { year: number; month: number; day: number } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return { year, month, day };
}

function formatLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local calendar weekday (0 = Sunday). Sundays are computed, never stored. */
export function isoWeekdayIndex(isoDate: string): number {
  const { year, month, day } = partsFromIso(isoDate);
  return new Date(year, month - 1, day).getDay();
}

export function isSunday(isoDate: string): boolean {
  return isoWeekdayIndex(isoDate) === 0;
}

export function isoWeekdayShort(isoDate: string): (typeof WEEKDAY_SHORT)[number] {
  return WEEKDAY_SHORT[isoWeekdayIndex(isoDate)];
}

export function eachIsoDateInclusive(startDate: string, endDate: string): string[] {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw new Error("startDate and endDate must be YYYY-MM-DD");
  }
  if (end < start) {
    throw new Error("endDate must be on or after startDate");
  }

  const { year, month, day } = partsFromIso(start);
  const cursor = new Date(year, month - 1, day);
  const dates: string[] = [];
  while (true) {
    const iso = formatLocalIso(cursor);
    if (iso > end) break;
    dates.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
