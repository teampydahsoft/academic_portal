import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";
import { DAY_CODE_TO_LABEL, type DayCode } from "./timing.service.js";

export type WorkloadFilters = {
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  batch?: string;
  year?: number;
  semester?: number;
  section?: string;
  academicYear?: string;
};

type Thresholds = {
  minPeriodsPerWeek: number;
  maxPeriodsPerWeek: number;
  maxPeriodsPerDay: number;
};

type AssignmentRow = RowDataPacket & {
  staff_link_id: number;
  hrms_employee_id: string;
  employee_code: string | null;
  display_name: string | null;
  department_name: string | null;
  entry_id: number;
  day_of_week: DayCode;
  entry_type: string;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  room_label: string | null;
  plan_id: number;
  college_id: number;
  course_id: number;
  branch_id: number;
  batch: string;
  year_of_study: number | null;
  semester_number: number | null;
  section_name: string | null;
  academic_year_label: string;
  slot_label: string | null;
  start_time: string | null;
  end_time: string | null;
  slot_type: string | null;
};

const DEFAULT_THRESHOLDS: Thresholds = {
  minPeriodsPerWeek: 8,
  maxPeriodsPerWeek: 20,
  maxPeriodsPerDay: 5,
};

function toMinutes(time: string | null | undefined) {
  if (!time) return null;
  const normalized = String(time).slice(0, 5);
  const [h, m] = normalized.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function slotDurationMinutes(start: string | null | undefined, end: string | null | undefined) {
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin == null || endMin == null || endMin <= startMin) return 0;
  return endMin - startMin;
}

function loadStatus(periods: number, thresholds: Thresholds) {
  if (periods > thresholds.maxPeriodsPerWeek) return "Overloaded";
  if (periods < thresholds.minPeriodsPerWeek) return "Underloaded";
  return "Balanced";
}

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

async function loadThresholds(collegeId?: number): Promise<Thresholds> {
  try {
    const rows = await queryAcademic<
      (RowDataPacket & {
        min_periods_per_week: number;
        max_periods_per_week: number;
        max_periods_per_day: number;
      })[]
    >(
      `
      SELECT min_periods_per_week, max_periods_per_week, max_periods_per_day
      FROM ap_workload_thresholds
      WHERE is_active = 1
        AND (college_id IS NULL OR college_id = ?)
      ORDER BY (college_id IS NULL) ASC, id DESC
      LIMIT 1
      `,
      [collegeId ?? null],
    );
    const row = rows[0];
    if (!row) return DEFAULT_THRESHOLDS;
    return {
      minPeriodsPerWeek: Number(row.min_periods_per_week) || DEFAULT_THRESHOLDS.minPeriodsPerWeek,
      maxPeriodsPerWeek: Number(row.max_periods_per_week) || DEFAULT_THRESHOLDS.maxPeriodsPerWeek,
      maxPeriodsPerDay: Number(row.max_periods_per_day) || DEFAULT_THRESHOLDS.maxPeriodsPerDay,
    };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

function assignmentWhere(filters: WorkloadFilters) {
  const where = [
    "p.status = 'published'",
    "e.faculty_staff_link_id IS NOT NULL",
    "ts.slot_type = 'CLASS'",
  ];
  const params: unknown[] = [];

  if (filters.collegeId) {
    where.push("p.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`p.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.courseId) {
    where.push("p.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("p.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`p.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.batch) {
    where.push("p.batch = ?");
    params.push(filters.batch);
  }
  if (filters.year != null) {
    where.push("p.year_of_study = ?");
    params.push(filters.year);
  }
  if (filters.semester != null) {
    where.push("p.semester_number = ?");
    params.push(filters.semester);
  }
  if (filters.section) {
    where.push("p.section_name = ?");
    params.push(filters.section);
  }
  if (filters.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(filters.academicYear);
  }

  return { whereSql: where.join(" AND "), params };
}

async function loadPublishedAssignments(filters: WorkloadFilters, facultyStaffLinkId?: number) {
  const { whereSql, params } = assignmentWhere(filters);
  const facultyClause = facultyStaffLinkId
    ? "AND e.faculty_staff_link_id = ?"
    : "";
  const queryParams = facultyStaffLinkId ? [...params, facultyStaffLinkId] : params;

  return queryAcademic<AssignmentRow[]>(
    `
    SELECT
      sl.id AS staff_link_id,
      sl.hrms_employee_id,
      sl.employee_code,
      sl.display_name,
      sl.department_name,
      e.id AS entry_id,
      e.day_of_week,
      e.entry_type,
      e.subject_id,
      e.subject_code,
      e.subject_name,
      e.room_label,
      p.id AS plan_id,
      p.college_id,
      p.course_id,
      p.branch_id,
      p.batch,
      p.year_of_study,
      p.semester_number,
      p.section_name,
      p.academic_year_label,
      ts.label AS slot_label,
      ts.start_time,
      ts.end_time,
      ts.slot_type
    FROM ap_timetable_entries e
    INNER JOIN ap_timetable_plans p ON p.id = e.plan_id
    INNER JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
    INNER JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(e.timing_slot_id, e.period_slot_id)
    WHERE ${whereSql}
      ${facultyClause}
    ORDER BY sl.display_name, e.day_of_week, ts.start_time, e.id
    `,
    queryParams,
  );
}

function mapAssignment(row: AssignmentRow) {
  const minutes = slotDurationMinutes(row.start_time, row.end_time);
  return {
    entryId: Number(row.entry_id),
    planId: Number(row.plan_id),
    dayOfWeek: row.day_of_week,
    dayLabel: DAY_CODE_TO_LABEL[row.day_of_week] ?? row.day_of_week,
    slotLabel: row.slot_label,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    minutes,
    entryType: row.entry_type,
    subjectId: row.subject_id,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    section: row.section_name,
    batch: row.batch,
    year: row.year_of_study,
    semester: row.semester_number,
    academicYear: row.academic_year_label,
    collegeId: row.college_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    roomLabel: row.room_label,
  };
}

function aggregateFaculty(rows: AssignmentRow[], thresholds: Thresholds) {
  const byStaff = new Map<number, AssignmentRow[]>();
  for (const row of rows) {
    const list = byStaff.get(Number(row.staff_link_id)) ?? [];
    list.push(row);
    byStaff.set(Number(row.staff_link_id), list);
  }

  return Array.from(byStaff.entries()).map(([staffLinkId, assignments]) => {
    const first = assignments[0];
    const minutesPerWeek = assignments.reduce(
      (sum, row) => sum + slotDurationMinutes(row.start_time, row.end_time),
      0,
    );
    const periodsPerWeek = assignments.length;
    const theory = assignments.filter((row) => row.entry_type === "theory").length;
    const lab = assignments.filter((row) => row.entry_type === "lab").length;
    const theoryMinutes = assignments
      .filter((row) => row.entry_type === "theory")
      .reduce((sum, row) => sum + slotDurationMinutes(row.start_time, row.end_time), 0);
    const labMinutes = assignments
      .filter((row) => row.entry_type === "lab")
      .reduce((sum, row) => sum + slotDurationMinutes(row.start_time, row.end_time), 0);
    const subjects = new Set(
      assignments.map((row) => row.subject_id ?? row.subject_code).filter(Boolean),
    );
    const sections = new Set(
      assignments.map((row) => `${row.branch_id}:${row.section_name ?? ""}:${row.batch}`),
    );
    const byDay = new Map<string, number>();
    for (const row of assignments) {
      byDay.set(row.day_of_week, (byDay.get(row.day_of_week) ?? 0) + 1);
    }
    const maxPeriodsInADay = Math.max(0, ...byDay.values());
    let status = loadStatus(periodsPerWeek, thresholds);
    if (maxPeriodsInADay > thresholds.maxPeriodsPerDay && status !== "Overloaded") {
      status = "Overloaded";
    }

    return {
      id: String(staffLinkId),
      staffLinkId,
      hrmsEmployeeId: first.hrms_employee_id,
      code: first.employee_code || first.hrms_employee_id,
      name: first.display_name?.trim() || first.hrms_employee_id,
      department: first.department_name?.trim() || "—",
      subjects: subjects.size,
      sections: sections.size,
      periodsPerWeek,
      minutesPerWeek,
      hoursPerWeek: roundHours(minutesPerWeek),
      theory,
      lab,
      theoryMinutes,
      labMinutes,
      maxPeriodsInADay,
      status,
    };
  });
}

export async function getWorkloadSummary(filters: WorkloadFilters = {}) {
  const [rows, thresholds] = await Promise.all([
    loadPublishedAssignments(filters),
    loadThresholds(filters.collegeId),
  ]);
  const faculty = aggregateFaculty(rows, thresholds).sort(
    (a, b) => b.minutesPerWeek - a.minutesPerWeek || b.periodsPerWeek - a.periodsPerWeek,
  );

  const overloaded = faculty.filter((f) => f.status === "Overloaded").length;
  const underloaded = faculty.filter((f) => f.status === "Underloaded").length;
  const balanced = faculty.filter((f) => f.status === "Balanced").length;
  const averageLoad =
    faculty.length === 0
      ? 0
      : Math.round(
          (faculty.reduce((sum, f) => sum + f.periodsPerWeek, 0) / faculty.length) * 10,
        ) / 10;
  const averageHours =
    faculty.length === 0
      ? 0
      : roundHours(
          faculty.reduce((sum, f) => sum + f.minutesPerWeek, 0) / faculty.length,
        );

  return {
    kpis: {
      totalFaculty: faculty.length,
      averageLoad,
      averageHours,
      overloaded,
      underloaded,
      balanced,
    },
    thresholds,
    faculty,
    source:
      "Derived from published ap_timetable_plans + ap_timetable_entries + ap_timing_template_slots. Faculty identity from ap_staff_link (HRMS).",
  };
}

export async function getFacultyWorkloadDetail(
  facultyId: string,
  filters: WorkloadFilters = {},
) {
  const staffLinkId = Number(facultyId);
  if (!Number.isFinite(staffLinkId)) return null;

  const [rows, thresholds] = await Promise.all([
    loadPublishedAssignments(filters, staffLinkId),
    loadThresholds(filters.collegeId),
  ]);

  const faculty = aggregateFaculty(rows, thresholds)[0] ?? null;
  if (!faculty && rows.length === 0) {
    const identity = await queryAcademic<
      (RowDataPacket & {
        id: number;
        hrms_employee_id: string;
        employee_code: string | null;
        display_name: string | null;
        department_name: string | null;
      })[]
    >(
      `SELECT id, hrms_employee_id, employee_code, display_name, department_name
       FROM ap_staff_link WHERE id = ? LIMIT 1`,
      [staffLinkId],
    );
    const row = identity[0];
    if (!row) return null;
    return {
      id: String(row.id),
      staffLinkId: Number(row.id),
      hrmsEmployeeId: row.hrms_employee_id,
      code: row.employee_code || row.hrms_employee_id,
      name: row.display_name?.trim() || row.hrms_employee_id,
      department: row.department_name?.trim() || "—",
      subjects: 0,
      sections: 0,
      periodsPerWeek: 0,
      minutesPerWeek: 0,
      hoursPerWeek: 0,
      theory: 0,
      lab: 0,
      theoryMinutes: 0,
      labMinutes: 0,
      maxPeriodsInADay: 0,
      status: "Underloaded" as const,
      assignments: [],
      byDay: [],
      thresholds,
      source:
        "No published timetable assignments for this faculty in the selected scope.",
    };
  }

  if (!faculty) return null;

  const assignments = rows.map(mapAssignment);
  const dayOrder: DayCode[] = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"];
  const byDay = dayOrder
    .map((day) => {
      const items = assignments.filter((item) => item.dayOfWeek === day);
      const minutes = items.reduce((sum, item) => sum + item.minutes, 0);
      return {
        dayOfWeek: day,
        dayLabel: DAY_CODE_TO_LABEL[day],
        periods: items.length,
        minutes,
        hours: roundHours(minutes),
        assignments: items,
      };
    })
    .filter((day) => day.periods > 0);

  return {
    ...faculty,
    assignments,
    byDay,
    thresholds,
    source:
      "Derived from published timetable entries and Academic Portal timing slots.",
  };
}
