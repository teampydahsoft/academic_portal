import type { RowDataPacket } from "mysql2";
import { executeStudent, queryAcademic, queryStudent } from "../db/pools.js";
import {
  eachIsoDateInclusive,
  isSunday,
  isoWeekdayShort,
  listCustomHolidays,
  resolveHolidayScopeNames,
  resolveSemesterWindow,
  type CustomHoliday,
  type HolidayScope,
} from "./student-academic-dates.service.js";
import {
  listPublicHolidays,
  type PublicHoliday,
} from "./nager-public-holidays.service.js";

/**
 * Attendance Calendar — Student DB calendar behavior.
 *
 * Institute holidays: student_database.custom_holidays
 *   Empty/NULL targets = Global (everyone)
 * Sundays: computed
 * Public holidays: Nager.Date (never stored)
 * Attendance badges: Academic Portal class sessions + posts
 * attendance_records are not calendar configuration.
 */

export type DayState =
  | "working_day"
  | "sunday"
  | "institute_holiday"
  | "public_holiday";

export type AttendanceBadge =
  | "sun"
  | "submitted"
  | "pending"
  | "upcoming"
  | "institute_holiday"
  | "public_holiday";

export type AttendanceCalendarDay = {
  date: string;
  weekday: string;
  isSunday: boolean;
  state: DayState;
  label: string;
  badge: AttendanceBadge;
  badgeLabel: string;
  instructionalDay: boolean;
  classSessionsExpected: boolean;
  sessionTotal: number;
  sessionPosted: number;
  instituteHolidays: Array<CustomHoliday & { isGlobal: boolean }>;
  publicHoliday: PublicHoliday | null;
};

export type AttendanceCalendar = {
  readOnly: true;
  source: {
    window: "student_database.semesters";
    instituteHolidays: "student_database.custom_holidays";
    sundays: "computed";
    publicHolidays: "nager.date";
    attendanceRecords: "not_used_as_calendar";
  };
  academicYear: string | null;
  academicYearId: number;
  collegeId: number;
  collegeName: string | null;
  courseId: number;
  courseName: string | null;
  branchId: number | null;
  branchName: string | null;
  batch: string | null;
  yearOfStudy: number;
  semesterNumber: number;
  semesterId: number;
  startDate: string;
  endDate: string;
  holidays: CustomHoliday[];
  instituteHolidays: CustomHoliday[];
  publicHolidays: PublicHoliday[];
  publicHolidaysCountry: string;
  publicHolidaysError: string | null;
  days: AttendanceCalendarDay[];
  counts: {
    workingDays: number;
    sundays: number;
    instituteHolidayDays: number;
    publicHolidayDays: number;
  };
  relationship: {
    workingDay: string;
    nonWorkingDay: string;
  };
};

type SessionAggRow = RowDataPacket & {
  d: string;
  total: number;
  posted: number;
};

function dayLabel(state: DayState): string {
  switch (state) {
    case "institute_holiday":
      return "Institute Holiday";
    case "public_holiday":
      return "Public Holiday";
    case "sunday":
      return "Sunday";
    default:
      return "Working Day";
  }
}

function hasTarget(raw: string | null | undefined): boolean {
  const text = (raw ?? "").trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.some((item) => {
        const token = String(item).trim().toLowerCase();
        return token.length > 0 && token !== "*" && token !== "all";
      });
    }
    if (parsed != null) {
      const token = String(parsed).trim().toLowerCase();
      return token.length > 0 && token !== "*" && token !== "all";
    }
  } catch {
    // not JSON
  }
  return text
    .split(/[,;|]/)
    .map((item) => item.trim().toLowerCase())
    .some((token) => token.length > 0 && token !== "*" && token !== "all");
}

export function isGlobalHoliday(holiday: CustomHoliday): boolean {
  return !(
    hasTarget(holiday.targetCollege) ||
    hasTarget(holiday.targetBatch) ||
    hasTarget(holiday.targetCourse) ||
    hasTarget(holiday.targetBranch) ||
    hasTarget(holiday.targetYear) ||
    hasTarget(holiday.targetSemester)
  );
}

function withGlobalFlag(holiday: CustomHoliday) {
  return { ...holiday, isGlobal: isGlobalHoliday(holiday) };
}

function todayIsoLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthBounds(year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

async function loadSessionStatusByDate(startDate: string, endDate: string) {
  const rows = await queryAcademic<SessionAggRow[]>(
    `
    SELECT
      DATE_FORMAT(cs.session_date, '%Y-%m-%d') AS d,
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN ap.id IS NOT NULL OR cs.status = 'posted' THEN 1
          ELSE 0
        END
      ) AS posted
    FROM ap_class_sessions cs
    LEFT JOIN ap_attendance_posts ap ON ap.class_session_id = cs.id
    WHERE cs.session_date >= ?
      AND cs.session_date <= ?
      AND cs.status <> 'cancelled'
    GROUP BY DATE_FORMAT(cs.session_date, '%Y-%m-%d')
    `,
    [startDate, endDate],
  );

  const map = new Map<string, { total: number; posted: number }>();
  for (const row of rows) {
    map.set(String(row.d).slice(0, 10), {
      total: Number(row.total ?? 0),
      posted: Number(row.posted ?? 0),
    });
  }
  return map;
}

function resolveBadge(input: {
  date: string;
  today: string;
  state: DayState;
  sessionTotal: number;
  sessionPosted: number;
}): { badge: AttendanceBadge; badgeLabel: string } {
  if (input.state === "sunday") return { badge: "sun", badgeLabel: "Sun" };
  if (input.state === "institute_holiday") {
    return { badge: "institute_holiday", badgeLabel: "Inst" };
  }
  if (input.state === "public_holiday") {
    return { badge: "public_holiday", badgeLabel: "Pub" };
  }

  if (input.date > input.today) {
    return { badge: "upcoming", badgeLabel: "Upcoming" };
  }

  if (input.sessionTotal > 0 && input.sessionPosted < input.sessionTotal) {
    return { badge: "pending", badgeLabel: "Pending" };
  }

  if (input.date === input.today && input.sessionTotal === 0) {
    return { badge: "pending", badgeLabel: "Pending" };
  }

  return { badge: "submitted", badgeLabel: "Submitted" };
}

function classifyDay(input: {
  date: string;
  today: string;
  instituteHolidays: CustomHoliday[];
  publicHoliday: PublicHoliday | null;
  sessionTotal: number;
  sessionPosted: number;
}): AttendanceCalendarDay {
  const sunday = isSunday(input.date);
  let state: DayState = "working_day";
  if (input.instituteHolidays.length > 0) {
    state = "institute_holiday";
  } else if (input.publicHoliday) {
    state = "public_holiday";
  } else if (sunday) {
    state = "sunday";
  }

  const { badge, badgeLabel } = resolveBadge({
    date: input.date,
    today: input.today,
    state,
    sessionTotal: input.sessionTotal,
    sessionPosted: input.sessionPosted,
  });

  return {
    date: input.date,
    weekday: isoWeekdayShort(input.date),
    isSunday: sunday,
    state,
    label: dayLabel(state),
    badge,
    badgeLabel,
    instructionalDay: state === "working_day",
    classSessionsExpected: state === "working_day",
    sessionTotal: input.sessionTotal,
    sessionPosted: input.sessionPosted,
    instituteHolidays: input.instituteHolidays.map(withGlobalFlag),
    publicHoliday: input.publicHoliday,
  };
}

export async function getMonthAttendanceCalendar(input: {
  year: number;
  month: number;
}) {
  const year = input.year;
  const month = input.month;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month");
  }

  const { startDate, endDate } = monthBounds(year, month);
  const today = todayIsoLocal();

  const [instituteHolidays, publicResult, sessionMap] = await Promise.all([
    listCustomHolidays({ startDate, endDate }),
    listPublicHolidays({ startDate, endDate }),
    loadSessionStatusByDate(startDate, endDate),
  ]);

  const instituteByDate = new Map<string, CustomHoliday[]>();
  for (const holiday of instituteHolidays) {
    const key = holiday.holidayDate.slice(0, 10);
    const list = instituteByDate.get(key) ?? [];
    list.push(holiday);
    instituteByDate.set(key, list);
  }

  const publicByDate = new Map<string, PublicHoliday>();
  for (const holiday of publicResult.holidays) {
    if (!publicByDate.has(holiday.date)) publicByDate.set(holiday.date, holiday);
  }

  const days = eachIsoDateInclusive(startDate, endDate).map((date) => {
    const sessions = sessionMap.get(date) ?? { total: 0, posted: 0 };
    return classifyDay({
      date,
      today,
      instituteHolidays: instituteByDate.get(date) ?? [],
      publicHoliday: publicByDate.get(date) ?? null,
      sessionTotal: sessions.total,
      sessionPosted: sessions.posted,
    });
  });

  return {
    source: {
      instituteHolidays: "student_database.custom_holidays",
      sundays: "computed",
      publicHolidays: "nager.date",
      attendanceStatus: "academic_portal.ap_class_sessions + ap_attendance_posts",
      attendanceRecords: "not_used_as_calendar",
    },
    year,
    month,
    startDate,
    endDate,
    today,
    days,
    instituteHolidays: instituteHolidays.map(withGlobalFlag),
    publicHolidays: publicResult.holidays,
    publicHolidaysCountry: publicResult.countryCode,
    publicHolidaysError: publicResult.error,
    legend: [
      { key: "public_holiday", label: "Public Holiday" },
      { key: "sunday", label: "Sunday" },
      { key: "institute_holiday", label: "Institute Holiday" },
      { key: "working_day", label: "Working Day" },
    ],
  };
}

export async function listHolidayTargetOptions() {
  const [colleges, courses, batches, total] = await Promise.all([
    queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM colleges ORDER BY name`,
    ),
    queryStudent<(RowDataPacket & { id: number; name: string; college_id: number })[]>(
      `SELECT id, name, college_id FROM courses ORDER BY name`,
    ),
    queryStudent<(RowDataPacket & { batch: string })[]>(
      `
      SELECT DISTINCT TRIM(batch) AS batch
      FROM students
      WHERE batch IS NOT NULL AND TRIM(batch) <> ''
      ORDER BY batch DESC
      `,
    ),
    queryStudent<(RowDataPacket & { c: number })[]>(
      `
      SELECT COUNT(*) AS c FROM students s
      WHERE s.student_status IS NULL
         OR LOWER(s.student_status) NOT IN ('relieved','discontinued','inactive','cancelled')
      `,
    ),
  ]);

  return {
    colleges: colleges.map((row) => ({ id: Number(row.id), name: row.name })),
    programs: courses.map((row) => ({
      id: Number(row.id),
      name: row.name,
      collegeId: Number(row.college_id),
    })),
    batches: batches.map((row) => String(row.batch)),
    defaultRecipientCount: Number(total[0]?.c ?? 0),
  };
}

export async function estimateHolidayRecipients(input: {
  collegeNames?: string[];
  batchValues?: string[];
  programNames?: string[];
}) {
  const where: string[] = [
    `(s.student_status IS NULL OR LOWER(s.student_status) NOT IN ('relieved','discontinued','inactive','cancelled'))`,
  ];
  const params: unknown[] = [];

  if (input.collegeNames?.length) {
    where.push(`s.college IN (${input.collegeNames.map(() => "?").join(",")})`);
    params.push(...input.collegeNames);
  }
  if (input.batchValues?.length) {
    where.push(`TRIM(s.batch) IN (${input.batchValues.map(() => "?").join(",")})`);
    params.push(...input.batchValues);
  }
  if (input.programNames?.length) {
    where.push(`s.course IN (${input.programNames.map(() => "?").join(",")})`);
    params.push(...input.programNames);
  }

  const rows = await queryStudent<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM students s WHERE ${where.join(" AND ")}`,
    params,
  );

  return {
    estimatedRecipients: Number(rows[0]?.c ?? 0),
    isGlobal:
      !input.collegeNames?.length &&
      !input.batchValues?.length &&
      !input.programNames?.length,
  };
}

function encodeTarget(values: string[] | null | undefined): string | null {
  // Empty / missing selection → NULL in Student DB = Global (all students).
  const cleaned = (values ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.toLowerCase() !== "all" && item !== "*");
  if (!cleaned.length) return null;
  return JSON.stringify(cleaned);
}

function normalizeHolidayWriteInput(input: {
  holidayDate: string;
  title: string;
  description?: string | null;
  targetColleges?: string[] | null;
  targetBatches?: string[] | null;
  targetPrograms?: string[] | null;
}) {
  const holidayDate = input.holidayDate?.trim().slice(0, 10);
  const title = input.title?.trim();
  if (!holidayDate || !/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
    throw Object.assign(new Error("holidayDate must be YYYY-MM-DD"), { status: 400 });
  }
  if (!title) {
    throw Object.assign(new Error("title is required"), { status: 400 });
  }

  const targetCollege = encodeTarget(input.targetColleges);
  const targetBatch = encodeTarget(input.targetBatches);
  const targetCourse = encodeTarget(input.targetPrograms);
  const appliesToAllStudents = !targetCollege && !targetBatch && !targetCourse;

  return {
    holidayDate,
    title,
    description: input.description?.trim() || null,
    targetCollege,
    targetBatch,
    targetCourse,
    appliesToAllStudents,
  };
}

async function reloadHoliday(id: number, holidayDate: string) {
  const rows = await listCustomHolidays({
    startDate: holidayDate,
    endDate: holidayDate,
  });
  const holiday = rows.find((row) => row.id === id);
  if (!holiday) {
    throw new Error("Holiday saved in Student Database but could not be reloaded");
  }
  return withGlobalFlag(holiday);
}

/**
 * Creates an institute holiday in student_database.custom_holidays.
 * Empty target filters are stored as NULL and apply to all students (Global).
 */
export async function createCustomHoliday(input: {
  holidayDate: string;
  title: string;
  description?: string | null;
  targetColleges?: string[] | null;
  targetBatches?: string[] | null;
  targetPrograms?: string[] | null;
  createdBy?: number | null;
}) {
  const normalized = normalizeHolidayWriteInput(input);

  const result = await executeStudent(
    `
    INSERT INTO custom_holidays
      (holiday_date, title, description, created_by,
       target_college, target_batch, target_course,
       target_branch, target_year, target_semester)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `,
    [
      normalized.holidayDate,
      normalized.title,
      normalized.description,
      input.createdBy ?? null,
      normalized.targetCollege,
      normalized.targetBatch,
      normalized.targetCourse,
    ],
  );

  const holiday = await reloadHoliday(Number(result.insertId), normalized.holidayDate);
  return {
    source: "student_database.custom_holidays" as const,
    database: "student_database" as const,
    table: "custom_holidays" as const,
    appliesToAllStudents: normalized.appliesToAllStudents,
    holiday,
  };
}

/**
 * Updates an existing institute holiday in student_database.custom_holidays.
 * Empty target filters are stored as NULL and apply to all students (Global).
 */
export async function updateCustomHoliday(
  holidayId: number,
  input: {
    holidayDate: string;
    title: string;
    description?: string | null;
    targetColleges?: string[] | null;
    targetBatches?: string[] | null;
    targetPrograms?: string[] | null;
  },
) {
  if (!Number.isInteger(holidayId) || holidayId <= 0) {
    throw Object.assign(new Error("holiday id is required"), { status: 400 });
  }

  const normalized = normalizeHolidayWriteInput(input);
  const existing = await queryStudent<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM custom_holidays WHERE id = ? LIMIT 1`,
    [holidayId],
  );
  if (!existing.length) {
    throw Object.assign(new Error("Holiday not found in Student Database"), { status: 404 });
  }

  await executeStudent(
    `
    UPDATE custom_holidays
    SET
      holiday_date = ?,
      title = ?,
      description = ?,
      target_college = ?,
      target_batch = ?,
      target_course = ?,
      target_branch = NULL,
      target_year = NULL,
      target_semester = NULL
    WHERE id = ?
    `,
    [
      normalized.holidayDate,
      normalized.title,
      normalized.description,
      normalized.targetCollege,
      normalized.targetBatch,
      normalized.targetCourse,
      holidayId,
    ],
  );

  const holiday = await reloadHoliday(holidayId, normalized.holidayDate);
  return {
    source: "student_database.custom_holidays" as const,
    database: "student_database" as const,
    table: "custom_holidays" as const,
    appliesToAllStudents: normalized.appliesToAllStudents,
    holiday,
  };
}

export async function getAttendanceCalendar(input: {
  collegeId: number;
  courseId: number;
  branchId?: number;
  batch?: string | null;
  yearOfStudy: number;
  semesterNumber: number;
}): Promise<AttendanceCalendar | null> {
  const window = await resolveSemesterWindow({
    collegeId: input.collegeId,
    courseId: input.courseId,
    batch: input.batch ?? null,
    yearOfStudy: input.yearOfStudy,
    semesterNumber: input.semesterNumber,
  });
  if (!window) return null;

  const scope: HolidayScope = await resolveHolidayScopeNames({
    collegeId: input.collegeId,
    courseId: input.courseId,
    branchId: input.branchId,
    batch: input.batch ?? null,
    yearOfStudy: input.yearOfStudy,
    semesterNumber: input.semesterNumber,
  });

  const [instituteHolidays, publicResult, sessionMap] = await Promise.all([
    listCustomHolidays({
      startDate: window.startDate,
      endDate: window.endDate,
      scope,
    }),
    listPublicHolidays({
      startDate: window.startDate,
      endDate: window.endDate,
    }),
    loadSessionStatusByDate(window.startDate, window.endDate),
  ]);

  const instituteByDate = new Map<string, CustomHoliday[]>();
  for (const holiday of instituteHolidays) {
    const key = holiday.holidayDate.slice(0, 10);
    const list = instituteByDate.get(key) ?? [];
    list.push(holiday);
    instituteByDate.set(key, list);
  }

  const publicByDate = new Map<string, PublicHoliday>();
  for (const holiday of publicResult.holidays) {
    if (!publicByDate.has(holiday.date)) publicByDate.set(holiday.date, holiday);
  }

  const today = todayIsoLocal();
  const days = eachIsoDateInclusive(window.startDate, window.endDate).map((date) => {
    const sessions = sessionMap.get(date) ?? { total: 0, posted: 0 };
    return classifyDay({
      date,
      today,
      instituteHolidays: instituteByDate.get(date) ?? [],
      publicHoliday: publicByDate.get(date) ?? null,
      sessionTotal: sessions.total,
      sessionPosted: sessions.posted,
    });
  });

  const counts = {
    workingDays: 0,
    sundays: 0,
    instituteHolidayDays: 0,
    publicHolidayDays: 0,
  };
  for (const day of days) {
    if (day.state === "working_day") counts.workingDays += 1;
    else if (day.state === "sunday") counts.sundays += 1;
    else if (day.state === "institute_holiday") counts.instituteHolidayDays += 1;
    else if (day.state === "public_holiday") counts.publicHolidayDays += 1;
  }

  return {
    readOnly: true,
    source: {
      window: "student_database.semesters",
      instituteHolidays: "student_database.custom_holidays",
      sundays: "computed",
      publicHolidays: "nager.date",
      attendanceRecords: "not_used_as_calendar",
    },
    academicYear: window.academicYearLabel,
    academicYearId: window.academicYearId,
    collegeId: input.collegeId,
    collegeName: scope.collegeName ?? null,
    courseId: input.courseId,
    courseName: scope.courseName ?? null,
    branchId: input.branchId ?? null,
    branchName: scope.branchName ?? null,
    batch: input.batch ?? window.batch,
    yearOfStudy: input.yearOfStudy,
    semesterNumber: input.semesterNumber,
    semesterId: window.semesterId,
    startDate: window.startDate,
    endDate: window.endDate,
    holidays: instituteHolidays,
    instituteHolidays,
    publicHolidays: publicResult.holidays,
    publicHolidaysCountry: publicResult.countryCode,
    publicHolidaysError: publicResult.error,
    days,
    counts,
    relationship: {
      workingDay: "Working day → class sessions may exist → attendance can be posted.",
      nonWorkingDay:
        "Holiday / Sunday → no normal class session should be expected. Class sessions still follow published timetable + existing holiday logic.",
    },
  };
}
