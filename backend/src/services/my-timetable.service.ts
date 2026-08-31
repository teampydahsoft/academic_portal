import type { RowDataPacket } from "mysql2";
import { queryAcademic, queryStudent } from "../db/pools.js";
import {
  getFacultyWorkloadDetail,
  type WorkloadFilters,
} from "./workload.service.js";
import {
  DAY_CODE_TO_LABEL,
  listTimingSlots,
  type DayCode,
} from "./timing.service.js";
import { ensureSessionsForDate } from "./class-sessions.service.js";
import { getMyTimetableDateOverrides } from "./faculty-substitution.service.js";

const WEEK_DAYS: DayCode[] = ["MON", "TUE", "WED", "THUR", "FRI", "SAT"];

type CatalogMaps = {
  colleges: Map<number, string>;
  courses: Map<number, string>;
  branches: Map<number, string>;
};

type TimingSlotRef = {
  startTime: string;
  endTime: string;
  slotLabel: string | null;
};

type EnrichedAssignment = {
  entryId: number;
  planId: number;
  dayOfWeek: string;
  dayLabel: string;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  minutes: number;
  entryType: string;
  subjectId: number | null;
  subjectCode: string | null;
  subjectName: string | null;
  section: string | null;
  batch: string;
  year: number | null;
  semester: number | null;
  academicYear: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  collegeName: string | null;
  courseName: string | null;
  branchName: string | null;
  roomLabel: string | null;
};

export type TimetablePeriod =
  | {
      kind: "class";
      entryId: number;
      startTime: string;
      endTime: string;
      slotLabel: string | null;
      minutes: number;
      entryType: string;
      subjectCode: string | null;
      subjectName: string | null;
      section: string | null;
      batch: string;
      year: number | null;
      semester: number | null;
      academicYear: string;
      collegeId: number;
      courseId: number;
      branchId: number;
      collegeName: string | null;
      courseName: string | null;
      branchName: string | null;
      roomLabel: string | null;
    }
  | {
      kind: "free";
      startTime: string;
      endTime: string;
      slotLabel: string | null;
    };

export type MyTimetableDay = {
  dayOfWeek: DayCode;
  dayLabel: string;
  classCount: number;
  periods: TimetablePeriod[];
};

async function resolveStaffLinkId(hrmsEmployeeId: string): Promise<number | null> {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_staff_link WHERE hrms_employee_id = ? LIMIT 1`,
    [hrmsEmployeeId],
  );
  const id = rows[0]?.id;
  return id != null ? Number(id) : null;
}

async function loadCatalogMaps(assignments: { collegeId: number; courseId: number; branchId: number }[]): Promise<CatalogMaps> {
  const collegeIds = [...new Set(assignments.map((a) => a.collegeId).filter(Boolean))];
  const courseIds = [...new Set(assignments.map((a) => a.courseId).filter(Boolean))];
  const branchIds = [...new Set(assignments.map((a) => a.branchId).filter(Boolean))];

  const colleges = new Map<number, string>();
  const courses = new Map<number, string>();
  const branches = new Map<number, string>();

  if (collegeIds.length) {
    const rows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM colleges WHERE id IN (${collegeIds.map(() => "?").join(",")})`,
      collegeIds,
    );
    for (const row of rows) colleges.set(Number(row.id), row.name);
  }

  if (courseIds.length) {
    const rows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM courses WHERE id IN (${courseIds.map(() => "?").join(",")})`,
      courseIds,
    );
    for (const row of rows) courses.set(Number(row.id), row.name);
  }

  if (branchIds.length) {
    const rows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM course_branches WHERE id IN (${branchIds.map(() => "?").join(",")})`,
      branchIds,
    );
    for (const row of rows) branches.set(Number(row.id), row.name);
  }

  return { colleges, courses, branches };
}

function enrichAssignments(
  assignments: Array<{
    entryId: number;
    planId: number;
    dayOfWeek: string;
    dayLabel: string;
    slotLabel: string | null;
    startTime: string | null;
    endTime: string | null;
    minutes: number;
    entryType: string;
    subjectId: number | null;
    subjectCode: string | null;
    subjectName: string | null;
    section: string | null;
    batch: string;
    year: number | null;
    semester: number | null;
    academicYear: string;
    collegeId: number;
    courseId: number;
    branchId: number;
    roomLabel: string | null;
  }>,
  catalog: CatalogMaps,
): EnrichedAssignment[] {
  return assignments.map((assignment) => ({
    ...assignment,
    collegeName: catalog.colleges.get(assignment.collegeId) ?? null,
    courseName: catalog.courses.get(assignment.courseId) ?? null,
    branchName: catalog.branches.get(assignment.branchId) ?? null,
  }));
}

async function loadClassSlotsByDay(staffLinkId: number): Promise<Map<DayCode, TimingSlotRef[]>> {
  const templateRows = await queryAcademic<(RowDataPacket & { timing_template_id: number })[]>(
    `
    SELECT DISTINCT p.timing_template_id
    FROM ap_timetable_entries e
    INNER JOIN ap_timetable_plans p ON p.id = e.plan_id AND p.status = 'published'
    WHERE e.faculty_staff_link_id = ?
      AND p.timing_template_id IS NOT NULL
    `,
    [staffLinkId],
  );

  const byDay = new Map<DayCode, Map<string, TimingSlotRef>>();

  for (const row of templateRows) {
    const slots = await listTimingSlots(Number(row.timing_template_id));
    for (const slot of slots) {
      if (slot.slotType !== "CLASS" || !slot.isActive) continue;
      const day = slot.dayOfWeek as DayCode;
      const dayMap = byDay.get(day) ?? new Map<string, TimingSlotRef>();
      const key = `${slot.startTime}|${slot.endTime}`;
      if (!dayMap.has(key)) {
        dayMap.set(key, {
          startTime: slot.startTime,
          endTime: slot.endTime,
          slotLabel: slot.label,
        });
      }
      byDay.set(day, dayMap);
    }
  }

  const result = new Map<DayCode, TimingSlotRef[]>();
  for (const [day, slotMap] of byDay.entries()) {
    result.set(
      day,
      [...slotMap.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    );
  }
  return result;
}

function buildDayPeriods(
  day: DayCode,
  assignments: EnrichedAssignment[],
  classSlotsByDay: Map<DayCode, TimingSlotRef[]>,
): TimetablePeriod[] {
  const dayAssignments = assignments
    .filter((item) => item.dayOfWeek === day && item.startTime && item.endTime)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  const occupied = new Set(
    dayAssignments.map((item) => `${item.startTime}|${item.endTime}`),
  );

  const periods: TimetablePeriod[] = dayAssignments.map((item) => ({
    kind: "class",
    entryId: item.entryId,
    startTime: item.startTime!,
    endTime: item.endTime!,
    slotLabel: item.slotLabel,
    minutes: item.minutes,
    entryType: item.entryType,
    subjectCode: item.subjectCode,
    subjectName: item.subjectName,
    section: item.section,
    batch: item.batch,
    year: item.year,
    semester: item.semester,
    academicYear: item.academicYear,
    collegeId: item.collegeId,
    courseId: item.courseId,
    branchId: item.branchId,
    collegeName: item.collegeName,
    courseName: item.courseName,
    branchName: item.branchName,
    roomLabel: item.roomLabel,
  }));

  const templateSlots = classSlotsByDay.get(day) ?? [];
  for (const slot of templateSlots) {
    const key = `${slot.startTime}|${slot.endTime}`;
    if (occupied.has(key)) continue;
    periods.push({
      kind: "free",
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotLabel: slot.slotLabel,
    });
  }

  return periods.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function getMyTimetable(
  hrmsEmployeeId: string | null | undefined,
  filters: WorkloadFilters = {},
) {
  if (!hrmsEmployeeId) {
    return {
      linked: false as const,
      reason: "no_hrms_link" as const,
      message: "Your account is not linked to an HRMS faculty profile.",
      faculty: null,
      summary: null,
      weekDays: [] as MyTimetableDay[],
      source: null,
    };
  }

  const staffLinkId = await resolveStaffLinkId(hrmsEmployeeId);
  if (!staffLinkId) {
    return {
      linked: false as const,
      reason: "no_staff_link" as const,
      message: "Your faculty profile could not be found for your HRMS account.",
      faculty: null,
      summary: null,
      weekDays: [] as MyTimetableDay[],
      source: null,
    };
  }

  const detail = await getFacultyWorkloadDetail(String(staffLinkId), filters);
  if (!detail) {
    return {
      linked: false as const,
      reason: "not_found" as const,
      message: "Staff profile could not be loaded.",
      faculty: null,
      summary: null,
      weekDays: [] as MyTimetableDay[],
      source: null,
    };
  }

  const catalog = await loadCatalogMaps(detail.assignments);
  const assignments = enrichAssignments(detail.assignments, catalog);
  const classSlotsByDay = await loadClassSlotsByDay(staffLinkId);

  const weekDays: MyTimetableDay[] = WEEK_DAYS.map((day) => {
    const dayAssignments = assignments.filter((item) => item.dayOfWeek === day);
    return {
      dayOfWeek: day,
      dayLabel: DAY_CODE_TO_LABEL[day],
      classCount: dayAssignments.length,
      periods: buildDayPeriods(day, assignments, classSlotsByDay),
    };
  });

  return {
    linked: true as const,
    reason: null,
    message: null,
    faculty: {
      id: detail.id,
      staffLinkId: detail.staffLinkId,
      hrmsEmployeeId: detail.hrmsEmployeeId,
      name: detail.name,
      code: detail.code,
      department: detail.department,
    },
    summary: {
      periodsThisWeek: detail.periodsPerWeek,
      theory: detail.theory,
      lab: detail.lab,
      hoursPerWeek: detail.hoursPerWeek,
      subjects: detail.subjects,
      sections: detail.sections,
    },
    weekDays,
    assignments,
    source: detail.source,
    published: detail.assignments.length > 0,
  };
}

export type MyTimetableDatePeriod =
  | ({
      kind: "regular";
    } & Omit<Extract<TimetablePeriod, { kind: "class" }>, never>)
  | {
      kind: "substituted";
      classSessionId: number;
      startTime: string;
      endTime: string;
      slotLabel: string | null;
      subjectName: string | null;
      sectionName: string;
      replacementFacultyName: string | null;
      requestId: number;
    }
  | {
      kind: "substitution";
      classSessionId: number;
      startTime: string;
      endTime: string;
      slotLabel: string | null;
      subjectName: string | null;
      sectionName: string;
      originalFacultyName: string | null;
      requestId: number;
    };

export async function getMyTimetableForDate(
  hrmsEmployeeId: string | null | undefined,
  sessionDate: string,
  filters: WorkloadFilters = {},
) {
  const base = await getMyTimetable(hrmsEmployeeId, filters);
  if (!base.linked || !base.faculty) {
    return { ...base, sessionDate, periods: [] as MyTimetableDatePeriod[] };
  }

  await ensureSessionsForDate(sessionDate, {
    collegeId: filters.collegeId,
    branchId: filters.branchId,
    batch: filters.batch,
    year: filters.year,
    semester: filters.semester,
    section: filters.section,
  });

  const overrides = await getMyTimetableDateOverrides(base.faculty.staffLinkId, sessionDate);

  const sessionRows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      start_time: string;
      end_time: string;
      slot_label: string | null;
      subject_name: string | null;
      section_name: string | null;
      room_label: string | null;
      timetable_entry_id: number;
    })[]
  >(
    `
    SELECT
      cs.id,
      cs.start_time,
      cs.end_time,
      ts.label AS slot_label,
      cs.subject_name,
      cs.section_name,
      cs.room_label,
      cs.timetable_entry_id
    FROM ap_class_sessions cs
    LEFT JOIN ap_timing_template_slots ts ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    WHERE cs.session_date = ?
      AND cs.faculty_staff_link_id = ?
      AND cs.status NOT IN ('cancelled', 'holiday')
    ORDER BY cs.start_time ASC, cs.id ASC
    `,
    [sessionDate, base.faculty.staffLinkId],
  );

  const periods: MyTimetableDatePeriod[] = [];

  for (const row of sessionRows) {
    const sessionId = Number(row.id);
    const incoming = overrides.incoming.find((item) => item.classSessionId === sessionId);
    if (incoming) {
      periods.push({
        kind: "substitution",
        classSessionId: sessionId,
        startTime: incoming.startTime ?? String(row.start_time).slice(0, 5),
        endTime: incoming.endTime ?? String(row.end_time).slice(0, 5),
        slotLabel: incoming.slotLabel ?? row.slot_label,
        subjectName: incoming.subjectName ?? row.subject_name,
        sectionName: incoming.sectionName ?? row.section_name ?? "—",
        originalFacultyName: incoming.originalFacultyName,
        requestId: incoming.requestId,
      });
      continue;
    }

    periods.push({
      kind: "regular",
      entryId: Number(row.timetable_entry_id),
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      slotLabel: row.slot_label,
      minutes: 0,
      entryType: "theory",
      subjectCode: null,
      subjectName: row.subject_name,
      section: row.section_name,
      batch: filters.batch ?? "",
      year: filters.year ?? null,
      semester: filters.semester ?? null,
      academicYear: filters.academicYear ?? "",
      collegeId: filters.collegeId ?? 0,
      courseId: filters.courseId ?? 0,
      branchId: filters.branchId ?? 0,
      collegeName: null,
      courseName: null,
      branchName: null,
      roomLabel: row.room_label,
    });
  }

  for (const outgoing of overrides.outgoing) {
    periods.push({
      kind: "substituted",
      classSessionId: outgoing.classSessionId,
      startTime: outgoing.startTime ?? "",
      endTime: outgoing.endTime ?? "",
      slotLabel: outgoing.slotLabel,
      subjectName: outgoing.subjectName,
      sectionName: outgoing.sectionName,
      replacementFacultyName: outgoing.replacementFacultyName,
      requestId: outgoing.requestId,
    });
  }

  periods.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    ...base,
    sessionDate,
    periods,
    substitutionCount: overrides.outgoing.length + overrides.incoming.length,
  };
}
