import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import type { DayCode } from "./timing.service.js";
import { DAY_CODE_TO_LABEL } from "./timing.service.js";
import {
  isIsoDate,
  listCustomHolidays,
  resolveSemesterWindow,
} from "./student-academic-dates.service.js";

type PlanRow = RowDataPacket & {
  id: number;
  academic_year_label: string;
  college_id: number;
  course_id: number;
  branch_id: number;
  batch: string;
  year_of_study: number | null;
  semester_number: number | null;
  section_name: string | null;
  timing_template_id: number | null;
  status: string;
  version_no: number;
};

  type EntrySlotRow = RowDataPacket & {
  entry_id: number;
  plan_id: number;
  day_of_week: DayCode;
  timing_slot_id: number;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  subject_type_snapshot: string | null;
  entry_type: string;
  faculty_staff_link_id: number | null;
  room_label: string | null;
  slot_label: string;
  start_time: string;
  end_time: string;
  slot_type: string;
};

type SessionRow = RowDataPacket & {
  id: number;
  timetable_entry_id: number;
  plan_id: number;
  college_id: number | null;
  academic_year_label: string | null;
  semester_number: number | null;
  timing_template_id: number | null;
  session_date: string;
  day_of_week: DayCode;
  start_time: string | null;
  end_time: string | null;
  period_slot_id: number;
  timing_slot_id: number | null;
  section_name: string | null;
  branch_id: number;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  subject_type_snapshot: string | null;
  faculty_staff_link_id: number | null;
  room_label: string | null;
  status: string;
  faculty_name?: string | null;
  faculty_hrms_id?: string | null;
  plan_version?: number | null;
  slot_label?: string | null;
};

function toDateOnly(value: string) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayCodeFromDate(d: Date): DayCode {
  // JS: 0=Sun ... 6=Sat
  const map: DayCode[] = ["SUN", "MON", "TUE", "WED", "THUR", "FRI", "SAT"];
  return map[d.getDay()];
}

function eachDateInclusive(startDate: string, endDate: string) {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  if (end < start) throw new Error("endDate must be on or after startDate");

  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    timetableEntryId: row.timetable_entry_id,
    planId: row.plan_id,
    planVersion: row.plan_version ?? null,
    collegeId: row.college_id,
    academicYear: row.academic_year_label,
    semester: row.semester_number,
    timingTemplateId: row.timing_template_id,
    timingSlotId: row.timing_slot_id ?? row.period_slot_id,
    slotLabel: row.slot_label ?? null,
    sessionDate: String(row.session_date).slice(0, 10),
    dayOfWeek: row.day_of_week,
    dayLabel: DAY_CODE_TO_LABEL[row.day_of_week] ?? row.day_of_week,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    sectionName: row.section_name,
    branchId: row.branch_id,
    subjectId: row.subject_id,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    subjectTypeSnapshot: row.subject_type_snapshot ?? null,
    facultyStaffLinkId: row.faculty_staff_link_id,
    facultyName: row.faculty_name ?? null,
    facultyHrmsId: row.faculty_hrms_id ?? null,
    roomLabel: row.room_label,
    status: row.status,
  };
}

export async function listClassSessions(filters: {
  planId?: number;
  date?: string;
  startDate?: string;
  endDate?: string;
  facultyStaffLinkId?: number;
  section?: string;
  branchId?: number;
  branchIds?: number[];
  collegeId?: number;
  collegeIds?: number[];
  status?: string;
  limit?: number;
}) {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.planId) {
    where.push("cs.plan_id = ?");
    params.push(filters.planId);
  }
  if (filters.date) {
    where.push("cs.session_date = ?");
    params.push(filters.date);
  }
  if (filters.startDate) {
    where.push("cs.session_date >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("cs.session_date <= ?");
    params.push(filters.endDate);
  }
  if (filters.facultyStaffLinkId) {
    where.push("cs.faculty_staff_link_id = ?");
    params.push(filters.facultyStaffLinkId);
  }
  if (filters.section) {
    where.push("cs.section_name = ?");
    params.push(filters.section);
  }
  if (filters.branchId) {
    where.push("cs.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`cs.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.collegeId) {
    where.push("cs.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`cs.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.status) {
    where.push("cs.status = ?");
    params.push(filters.status);
  }

  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  params.push(limit);

  const rows = await queryAcademic<SessionRow[]>(
    `
    SELECT
      cs.*,
      p.version_no AS plan_version,
      sl.display_name AS faculty_name,
      sl.hrms_employee_id AS faculty_hrms_id,
      ts.label AS slot_label
    FROM ap_class_sessions cs
    LEFT JOIN ap_timetable_plans p ON p.id = cs.plan_id
    LEFT JOIN ap_staff_link sl ON sl.id = cs.faculty_staff_link_id
    LEFT JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    WHERE ${where.join(" AND ")}
    ORDER BY cs.session_date, cs.start_time, cs.id
    LIMIT ?
    `,
    params,
  );

  return rows.map(mapSession);
}

/**
 * Generate class sessions from a PUBLISHED timetable.
 *
 * Date range: Student DB `semesters.start_date` / `end_date` by default.
 * Non-working dates: Student DB `custom_holidays` (not attendance_records).
 * Timing: Academic Portal CLASS slots only.
 */
export async function generateClassSessions(input: {
  publishedTimetablePlanId: number;
  startDate?: string;
  endDate?: string;
}) {
  const plans = await queryAcademic<PlanRow[]>(
    `SELECT * FROM ap_timetable_plans WHERE id = ? LIMIT 1`,
    [input.publishedTimetablePlanId],
  );
  const plan = plans[0];
  if (!plan) throw new Error("Timetable plan not found");
  if (plan.status !== "published") {
    throw new Error(
      `Class sessions can only be generated from published timetables (current status: ${plan.status})`,
    );
  }
  if (!plan.timing_template_id) {
    throw new Error("Published plan has no timing template");
  }
  if (plan.year_of_study == null || plan.semester_number == null) {
    throw new Error(
      "Published plan is missing year of study or semester; cannot resolve Student DB semester dates",
    );
  }

  const semesterWindow = await resolveSemesterWindow({
    collegeId: plan.college_id,
    courseId: plan.course_id,
    batch: plan.batch,
    yearOfStudy: plan.year_of_study,
    semesterNumber: plan.semester_number,
  });

  if (input.startDate != null && String(input.startDate).trim() !== "" && !isIsoDate(input.startDate)) {
    throw new Error("Invalid date: startDate must be YYYY-MM-DD");
  }
  if (input.endDate != null && String(input.endDate).trim() !== "" && !isIsoDate(input.endDate)) {
    throw new Error("Invalid date: endDate must be YYYY-MM-DD");
  }

  const requestedStart = isIsoDate(input.startDate) ? input.startDate.trim() : null;
  const requestedEnd = isIsoDate(input.endDate) ? input.endDate.trim() : null;
  if ((requestedStart && !requestedEnd) || (!requestedStart && requestedEnd)) {
    throw new Error("startDate and endDate must both be provided when overriding the semester window");
  }

  const startDate = requestedStart ?? semesterWindow?.startDate ?? null;
  const endDate = requestedEnd ?? semesterWindow?.endDate ?? null;
  if (!startDate || !endDate) {
    throw new Error(
      "Semester dates not found in Student Database for this college / course / batch / year / semester. Set dates in Settings → Semester Dates, or pass startDate and endDate.",
    );
  }

  const holidayScope = {
    collegeId: plan.college_id,
    courseId: plan.course_id,
    branchId: plan.branch_id,
    batch: plan.batch,
    yearOfStudy: plan.year_of_study,
    semesterNumber: plan.semester_number,
  };
  const holidays = await listCustomHolidays({ startDate, endDate, scope: holidayScope });
  const skippedHolidayDates = new Set(holidays.map((h) => h.holidayDate));

  const entries = await queryAcademic<EntrySlotRow[]>(
    `
    SELECT
      e.id AS entry_id,
      e.plan_id,
      e.day_of_week,
      COALESCE(e.timing_slot_id, e.period_slot_id) AS timing_slot_id,
      e.subject_id,
      e.subject_code,
      e.subject_name,
      e.subject_type_snapshot,
      e.entry_type,
      e.faculty_staff_link_id,
      e.room_label,
      s.label AS slot_label,
      s.start_time,
      s.end_time,
      s.slot_type
    FROM ap_timetable_entries e
    INNER JOIN ap_timing_template_slots s
      ON s.id = COALESCE(e.timing_slot_id, e.period_slot_id)
    WHERE e.plan_id = ?
      AND s.slot_type = 'CLASS'
      AND e.subject_id IS NOT NULL
    `,
    [plan.id],
  );

  const byDay = new Map<DayCode, EntrySlotRow[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.day_of_week) ?? [];
    list.push(entry);
    byDay.set(entry.day_of_week, list);
  }

  const dates = eachDateInclusive(startDate, endDate);
  let created = 0;
  let skippedExisting = 0;
  let skippedNoClasses = 0;
  let skippedHolidays = 0;

  for (const date of dates) {
    const sessionDate = formatDate(date);
    if (skippedHolidayDates.has(sessionDate)) {
      skippedHolidays += 1;
      continue;
    }

    const dayCode = dayCodeFromDate(date);
    const dayEntries = byDay.get(dayCode) ?? [];
    if (dayEntries.length === 0) {
      skippedNoClasses += 1;
      continue;
    }

    for (const entry of dayEntries) {
      try {
        const result = await executeAcademic(
          `
          INSERT INTO ap_class_sessions
            (timetable_entry_id, plan_id, college_id, academic_year_label, semester_number,
             timing_template_id, session_date, day_of_week, start_time, end_time,
             period_slot_id, timing_slot_id, section_name, branch_id, subject_id,
             subject_code, subject_name, subject_type_snapshot, faculty_staff_link_id,
             room_label, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
          `,
          [
            entry.entry_id,
            plan.id,
            plan.college_id,
            plan.academic_year_label,
            plan.semester_number,
            plan.timing_template_id,
            sessionDate,
            entry.day_of_week,
            entry.start_time,
            entry.end_time,
            entry.timing_slot_id,
            entry.timing_slot_id,
            plan.section_name,
            plan.branch_id,
            entry.subject_id,
            entry.subject_code,
            entry.subject_name,
            entry.subject_type_snapshot ?? null,
            entry.faculty_staff_link_id,
            entry.room_label,
          ],
        );
        if ((result as ResultSetHeader).affectedRows > 0) created += 1;
      } catch (error) {
        const err = error as { code?: string };
        // Unique (timetable_entry_id, session_date) — preserve historical sessions
        if (err.code === "ER_DUP_ENTRY") {
          skippedExisting += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return {
    planId: plan.id,
    planStatus: plan.status,
    planVersion: plan.version_no,
    timingTemplateId: plan.timing_template_id,
    startDate,
    endDate,
    dateRangeSource: requestedStart ? "override" : "student_database.semesters",
    semesterWindow,
    holidaysSkipped: holidays.map((h) => ({
      date: h.holidayDate,
      title: h.title,
    })),
    classEntryCount: entries.length,
    created,
    skippedExisting,
    skippedHolidayDates: skippedHolidays,
    skippedDatesWithoutClasses: skippedNoClasses,
    note:
      "Date range defaults to student_database.semesters. Declared holidays come from student_database.custom_holidays. attendance_records are not used as a calendar.",
  };
}

export async function getClassSessionById(sessionId: number) {
  const detail = await queryAcademic<SessionRow[]>(
    `
    SELECT
      cs.*,
      p.version_no AS plan_version,
      sl.display_name AS faculty_name,
      sl.hrms_employee_id AS faculty_hrms_id,
      ts.label AS slot_label
    FROM ap_class_sessions cs
    LEFT JOIN ap_timetable_plans p ON p.id = cs.plan_id
    LEFT JOIN ap_staff_link sl ON sl.id = cs.faculty_staff_link_id
    LEFT JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    WHERE cs.id = ?
    LIMIT 1
    `,
    [sessionId],
  );
  return detail[0] ? mapSession(detail[0]) : null;
}

export async function listPublishedPlanIds(filters: {
  collegeId?: number;
  courseId?: number;
  branchId?: number;
  batch?: string;
  year?: number;
  semester?: number;
  section?: string;
  academicYear?: string;
}) {
  const where = ["status = 'published'"];
  const params: unknown[] = [];
  if (filters.collegeId) {
    where.push("college_id = ?");
    params.push(filters.collegeId);
  }
  if (filters.courseId) {
    where.push("course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.batch) {
    where.push("batch = ?");
    params.push(filters.batch);
  }
  if (filters.year != null) {
    where.push("year_of_study = ?");
    params.push(filters.year);
  }
  if (filters.semester != null) {
    where.push("semester_number = ?");
    params.push(filters.semester);
  }
  if (filters.section) {
    where.push("section_name = ?");
    params.push(filters.section);
  }
  if (filters.academicYear) {
    where.push("academic_year_label = ?");
    params.push(filters.academicYear);
  }

  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_timetable_plans WHERE ${where.join(" AND ")} ORDER BY id`,
    params,
  );
  return rows.map((row) => Number(row.id));
}

/** Generate sessions for one date from matching published timetables. */
export async function ensureSessionsForDate(
  date: string,
  filters: Parameters<typeof listPublishedPlanIds>[0] = {},
) {
  const planIds = await listPublishedPlanIds(filters);
  const results: Array<{ planId: number; created: number; skippedHolidayDates: number; error?: string }> =
    [];

  for (const planId of planIds) {
    try {
      const generated = await generateClassSessions({
        publishedTimetablePlanId: planId,
        startDate: date,
        endDate: date,
      });
      results.push({
        planId,
        created: generated.created,
        skippedHolidayDates: generated.skippedHolidayDates,
      });
    } catch (error) {
      results.push({
        planId,
        created: 0,
        skippedHolidayDates: 0,
        error: error instanceof Error ? error.message : "Failed to generate",
      });
    }
  }

  return {
    date,
    planCount: planIds.length,
    created: results.reduce((sum, row) => sum + row.created, 0),
    results,
  };
}
