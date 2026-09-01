import type { RowDataPacket } from "mysql2";
import { getHrmsDb, queryAcademic, queryStudent } from "../db/pools.js";
import {
  extractHrmsStaffProfile,
  HRMS_EMPLOYEE_PROJECTION,
  loadHrmsOrgLookups,
} from "./hrms-staff.service.js";
import {
  DAY_CODE_TO_LABEL,
  DAY_LABEL_TO_CODE,
  isNonClassTimingSlot,
  listTimingSlots,
  timingSlotDisplayLabel,
  type DayCode,
} from "./timing.service.js";

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
  division?: string;
  department?: string;
  search?: string;
  /** When true, only auth scope (college/branch) is applied — not academic page filters. */
  scopeOnly?: boolean;
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
  timing_slot_id: number | null;
  period_slot_id: number | null;
  timing_template_id: number | null;
  timing_template_name: string | null;
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
  const scopeOnly = Boolean(filters.scopeOnly);

  if (filters.collegeId) {
    where.push("p.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`p.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (!scopeOnly) {
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
  } else if (filters.branchIds?.length) {
    where.push(`p.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }

  return { whereSql: where.join(" AND "), params };
}

type HrmsStaffMeta = {
  department: string;
  division: string;
  designation: string;
};

async function loadHrmsStaffMetaMap(hrmsIds: string[]) {
  const unique = [...new Set(hrmsIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, HrmsStaffMeta>();
  if (!unique.length) return map;

  try {
    const db = await getHrmsDb();
    const lookups = await loadHrmsOrgLookups(db);
    const employees = await db
      .collection("employees")
      .find({
        $or: [
          { emp_no: { $in: unique } },
          { employeeId: { $in: unique } },
          { employeeCode: { $in: unique } },
          { empCode: { $in: unique } },
        ],
      })
      .project(HRMS_EMPLOYEE_PROJECTION)
      .toArray();

    for (const doc of employees) {
      const profile = extractHrmsStaffProfile(doc as Record<string, unknown>, lookups);
      map.set(profile.hrmsId, {
        department: profile.department,
        division: profile.division,
        designation: profile.designation,
      });
    }
  } catch {
    // HRMS unavailable — fall back to ap_staff_link.department_name
  }

  return map;
}

type CatalogMaps = {
  colleges: Map<number, string>;
  courses: Map<number, string>;
  branches: Map<number, string>;
};

async function loadCatalogMaps(assignments: Array<{ collegeId: number; courseId: number; branchId: number }>) {
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
      p.timing_template_id,
      tm.name AS timing_template_name,
      e.timing_slot_id,
      e.period_slot_id,
      ts.label AS slot_label,
      ts.start_time,
      ts.end_time,
      ts.slot_type
    FROM ap_timetable_entries e
    INNER JOIN ap_timetable_plans p ON p.id = e.plan_id
    INNER JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
    LEFT JOIN ap_timing_templates tm ON tm.id = p.timing_template_id
    INNER JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(e.timing_slot_id, e.period_slot_id)
    WHERE ${whereSql}
      ${facultyClause}
    ORDER BY sl.display_name, e.day_of_week, ts.start_time, e.id
    `,
    queryParams,
  );
}

function mapAssignment(row: AssignmentRow, catalog?: CatalogMaps) {
  const minutes = slotDurationMinutes(row.start_time, row.end_time);
  const collegeId = Number(row.college_id);
  const courseId = Number(row.course_id);
  const branchId = Number(row.branch_id);
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
    collegeId,
    courseId,
    branchId,
    collegeName: catalog?.colleges.get(collegeId) ?? null,
    courseName: catalog?.courses.get(courseId) ?? null,
    branchName: catalog?.branches.get(branchId) ?? null,
    timingSlotId: Number(row.timing_slot_id ?? row.period_slot_id) || null,
    timingTemplateId: row.timing_template_id ? Number(row.timing_template_id) : null,
    timingTemplateName: row.timing_template_name,
    roomLabel: row.room_label,
  };
}

function resolveDepartment(
  row: AssignmentRow,
  hrmsMap: Map<string, HrmsStaffMeta>,
) {
  const hrms = hrmsMap.get(row.hrms_employee_id);
  if (hrms?.department && hrms.department !== "—") return hrms.department;
  const fromLink = row.department_name?.trim();
  return fromLink && fromLink !== "—" ? fromLink : "—";
}

function aggregateFaculty(
  rows: AssignmentRow[],
  thresholds: Thresholds,
  hrmsMap: Map<string, HrmsStaffMeta>,
) {
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
    const byDayMinutes = new Map<string, number>();
    for (const row of assignments) {
      byDayMinutes.set(
        row.day_of_week,
        (byDayMinutes.get(row.day_of_week) ?? 0) +
          slotDurationMinutes(row.start_time, row.end_time),
      );
    }
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
      department: resolveDepartment(first, hrmsMap),
      division: hrmsMap.get(first.hrms_employee_id)?.division ?? "—",
      designation: hrmsMap.get(first.hrms_employee_id)?.designation ?? "—",
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
      hoursByDay: {
        MON: roundHours(byDayMinutes.get("MON") ?? 0),
        TUE: roundHours(byDayMinutes.get("TUE") ?? 0),
        WED: roundHours(byDayMinutes.get("WED") ?? 0),
        THUR: roundHours(byDayMinutes.get("THUR") ?? 0),
        FRI: roundHours(byDayMinutes.get("FRI") ?? 0),
        SAT: roundHours(byDayMinutes.get("SAT") ?? 0),
        SUN: roundHours(byDayMinutes.get("SUN") ?? 0),
      },
      periodsByDay: {
        MON: byDay.get("MON") ?? 0,
        TUE: byDay.get("TUE") ?? 0,
        WED: byDay.get("WED") ?? 0,
        THUR: byDay.get("THUR") ?? 0,
        FRI: byDay.get("FRI") ?? 0,
        SAT: byDay.get("SAT") ?? 0,
        SUN: byDay.get("SUN") ?? 0,
      },
    };
  });
}

const DAY_ORDER: DayCode[] = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"];

type MappedAssignment = ReturnType<typeof mapAssignment>;

type FacultyTimetableCell =
  | {
      kind: "class";
      branchName: string | null;
      year: number | null;
      semester: number | null;
      subjectName: string | null;
      entryType: string;
    }
  | { kind: "break"; label: string }
  | null;

function slotSignature(
  label: string | null | undefined,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
) {
  return `${label ?? ""}:${startTime ?? ""}:${endTime ?? ""}`;
}

async function buildFacultyTimetable(assignments: MappedAssignment[]) {
  if (!assignments.length) return null;

  const templateCounts = new Map<number, number>();
  for (const item of assignments) {
    if (!item.timingTemplateId) continue;
    templateCounts.set(
      item.timingTemplateId,
      (templateCounts.get(item.timingTemplateId) ?? 0) + 1,
    );
  }
  const templateId = [...templateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!templateId) return null;

  const slots = await listTimingSlots(templateId);
  if (!slots.length) return null;

  const templateName = assignments.find((item) => item.timingTemplateId === templateId)
    ?.timingTemplateName;

  const days = [...new Set(slots.map((slot) => slot.dayLabel))];
  const slotsByDay: Record<
    string,
    Array<{
      id: number;
      label: string;
      startTime: string;
      endTime: string;
      slotType: string;
      isAssignable: boolean;
    }>
  > = {};

  for (const slot of slots) {
    slotsByDay[slot.dayLabel] = slotsByDay[slot.dayLabel] ?? [];
    slotsByDay[slot.dayLabel].push({
      id: slot.id,
      label: slot.label,
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotType: slot.slotType,
      isAssignable: slot.isAssignable,
    });
  }

  const assignmentMap = new Map<string, MappedAssignment>();
  for (const item of assignments) {
    assignmentMap.set(
      `${item.dayOfWeek}:${slotSignature(item.slotLabel, item.startTime, item.endTime)}`,
      item,
    );
  }

  const headerSlots = slotsByDay[days[0]] ?? [];
  const grid: Record<string, Record<number, FacultyTimetableCell>> = {};

  for (const day of days) {
    grid[day] = {};
    const dayCode = DAY_LABEL_TO_CODE[day] ?? day;
    for (const slot of slotsByDay[day] ?? []) {
      const isBreak = isNonClassTimingSlot(slot);

      if (isBreak) {
        grid[day][slot.id] = { kind: "break", label: timingSlotDisplayLabel(slot) };
        continue;
      }

      const found = assignmentMap.get(
        `${dayCode}:${slotSignature(slot.label, slot.startTime, slot.endTime)}`,
      );
      grid[day][slot.id] = found
        ? {
            kind: "class",
            branchName: found.branchName,
            year: found.year,
            semester: found.semester,
            subjectName: found.subjectName,
            entryType: found.entryType,
          }
        : null;
    }
  }

  return {
    timingTemplateId: templateId,
    timingTemplateName: templateName,
    periodsPerWeek: assignments.length,
    days,
    headerSlots,
    slotsByDay,
    grid,
  };
}

function matchesStaffFilters(
  faculty: {
    hrmsEmployeeId: string;
    name: string;
    code: string;
    department: string;
    division: string;
  },
  filters: WorkloadFilters,
) {
  if (filters.division && faculty.division !== filters.division) return false;
  if (filters.department && faculty.department !== filters.department) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    if (
      !faculty.name.toLowerCase().includes(q) &&
      !faculty.code.toLowerCase().includes(q) &&
      !faculty.hrmsEmployeeId.toLowerCase().includes(q) &&
      !faculty.department.toLowerCase().includes(q)
    ) {
      return false;
    }
  }
  return true;
}

function buildFilterOptions(
  faculty: Array<{ department: string; division: string }>,
) {
  return {
    divisions: [...new Set(faculty.map((f) => f.division).filter((v) => v && v !== "—"))].sort(),
    departments: [...new Set(faculty.map((f) => f.department).filter((v) => v && v !== "—"))].sort(),
  };
}

export async function getWorkloadSummary(filters: WorkloadFilters = {}) {
  const queryFilters: WorkloadFilters = {
    collegeId: filters.collegeId,
    collegeIds: filters.collegeIds,
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    scopeOnly: true,
  };

  const [rows, thresholds] = await Promise.all([
    loadPublishedAssignments(queryFilters),
    loadThresholds(filters.collegeId),
  ]);
  const hrmsMap = await loadHrmsStaffMetaMap(rows.map((row) => row.hrms_employee_id));
  const allFaculty = aggregateFaculty(rows, thresholds, hrmsMap).sort(
    (a, b) => b.minutesPerWeek - a.minutesPerWeek || b.periodsPerWeek - a.periodsPerWeek,
  );
  const filterOptions = buildFilterOptions(allFaculty);
  const faculty = allFaculty.filter((member) => matchesStaffFilters(member, filters));

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
    filterOptions,
    source:
      "Faculty workload from all published timetables in your access scope. Filter by division or department — not tied to a single class section.",
  };
}

export async function getFacultyWorkloadDetail(
  facultyId: string,
  filters: WorkloadFilters = {},
) {
  const staffLinkId = Number(facultyId);
  if (!Number.isFinite(staffLinkId)) return null;

  const detailFilters: WorkloadFilters = {
    collegeId: filters.collegeId,
    collegeIds: filters.collegeIds,
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    scopeOnly: true,
  };

  const [rows, thresholds] = await Promise.all([
    loadPublishedAssignments(detailFilters, staffLinkId),
    loadThresholds(filters.collegeId),
  ]);

  const hrmsMap = await loadHrmsStaffMetaMap(rows.map((row) => row.hrms_employee_id));
  const faculty = aggregateFaculty(rows, thresholds, hrmsMap)[0] ?? null;
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
    const identityHrmsMap = await loadHrmsStaffMetaMap([row.hrms_employee_id]);
    const hrms = identityHrmsMap.get(row.hrms_employee_id);
    return {
      id: String(row.id),
      staffLinkId: Number(row.id),
      hrmsEmployeeId: row.hrms_employee_id,
      code: row.employee_code || row.hrms_employee_id,
      name: row.display_name?.trim() || row.hrms_employee_id,
      department:
        hrms?.department && hrms.department !== "—"
          ? hrms.department
          : row.department_name?.trim() || "—",
      division: hrms?.division ?? "—",
      designation: hrms?.designation ?? "—",
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
      timetable: null,
      byDay: [],
      thresholds,
      source:
        "No published timetable assignments for this faculty in your access scope.",
    };
  }

  if (!faculty) return null;

  const catalog = await loadCatalogMaps(
    rows.map((row) => ({
      collegeId: Number(row.college_id),
      courseId: Number(row.course_id),
      branchId: Number(row.branch_id),
    })),
  );
  const assignments = rows.map((row) => mapAssignment(row, catalog));
  const timetable = await buildFacultyTimetable(assignments);
  const byDay = DAY_ORDER
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
    timetable,
    byDay,
    thresholds,
    source:
      "Weekly teaching grid across all branches and sections. Each period shows branch, year, and semester.",
  };
}
