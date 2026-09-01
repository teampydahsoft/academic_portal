import type { RowDataPacket } from "mysql2";
import { getHrmsDb, queryAcademic, queryStudent } from "../db/pools.js";
import {
  extractHrmsStaffProfile,
  HRMS_EMPLOYEE_PROJECTION,
  loadHrmsOrgLookups,
} from "./hrms-staff.service.js";
import {
  employeeMatchesFacultyGroupFilter,
  getFacultyGroupFilter,
} from "./portal-settings.service.js";
import { slotDurationMinutes } from "./workload.service.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FacultyListFilters = {
  division?: string;
  department?: string;
  search?: string;
  linkStatus?: "linked" | "unlinked" | "all";
  /** When set, keep only faculty whose HRMS college name matches (case-insensitive). */
  collegeNames?: string[];
  page?: number;
  pageSize?: number;
};

export type FacultyListItem = {
  hrmsEmployeeId: string;
  staffLinkId: number | null;
  name: string;
  code: string;
  division: string;
  department: string;
  designation: string;
  college: string;
  employeeGroup: string;
  isActive: boolean;
  linkStatus: "linked" | "unlinked";
};

type StaffLinkRow = RowDataPacket & {
  id: number;
  hrms_employee_id: string;
  employee_code: string | null;
  display_name: string | null;
  department_name: string | null;
};

type EntryRow = RowDataPacket & {
  entry_id: number;
  plan_id: number;
  day_of_week: string;
  entry_type: string;
  subject_code: string | null;
  subject_name: string | null;
  section_name: string | null;
  batch: string;
  year_of_study: number | null;
  semester_number: number | null;
  college_id: number;
  course_id: number;
  branch_id: number;
  academic_year_label: string;
  slot_label: string | null;
  start_time: string | null;
  end_time: string | null;
  room_label: string | null;
};

// ─── listFaculty ───────────────────────────────────────────────────────────────

const FACULTY_ROWS_TTL_MS = 60 * 1000;
let facultyRowsCache: { expiresAt: number; rows: FacultyListItem[] } | null = null;
let facultyRowsInflight: Promise<FacultyListItem[]> | null = null;

export function invalidateFacultyRowsCache() {
  facultyRowsCache = null;
}

async function loadFacultyRows(): Promise<FacultyListItem[]> {
  if (facultyRowsCache && facultyRowsCache.expiresAt > Date.now()) {
    return facultyRowsCache.rows;
  }
  if (facultyRowsInflight) return facultyRowsInflight;

  facultyRowsInflight = (async () => {
    const db = await getHrmsDb();

    // Run Mongo lookups, group filter, employee scan, and AP staff links in parallel.
    const [lookups, groupFilter, employees, linkRows] = await Promise.all([
      loadHrmsOrgLookups(db),
      getFacultyGroupFilter(),
      db
        .collection("employees")
        .find({
          $or: [{ is_active: true }, { is_active: { $exists: false } }],
        })
        .project(HRMS_EMPLOYEE_PROJECTION)
        .limit(2000)
        .toArray(),
      queryAcademic<StaffLinkRow[]>(
        `SELECT id, hrms_employee_id, employee_code, display_name, department_name
         FROM ap_staff_link`,
      ),
    ]);

    const linkMap = new Map<string, StaffLinkRow>();
    for (const row of linkRows) {
      linkMap.set(row.hrms_employee_id, row);
    }

    const rows: FacultyListItem[] = [];
    for (const raw of employees) {
      const emp = extractHrmsStaffProfile(raw as Record<string, unknown>, lookups);
      if (
        !employeeMatchesFacultyGroupFilter(
          groupFilter,
          emp.employeeGroupId,
          emp.employeeGroup,
        )
      ) {
        continue;
      }
      const link = linkMap.get(emp.hrmsId);
      rows.push({
        hrmsEmployeeId: emp.hrmsId,
        staffLinkId: link ? Number(link.id) : null,
        name: emp.name,
        code: link?.employee_code ?? emp.hrmsId,
        division: emp.division,
        department: emp.department,
        designation: emp.designation,
        college: emp.college,
        employeeGroup: emp.employeeGroup,
        isActive: emp.isActive,
        linkStatus: link ? ("linked" as const) : ("unlinked" as const),
      });
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));
    facultyRowsCache = { expiresAt: Date.now() + FACULTY_ROWS_TTL_MS, rows };
    return rows;
  })().finally(() => {
    facultyRowsInflight = null;
  });

  return facultyRowsInflight;
}

function applyFacultyFilters(
  rows: FacultyListItem[],
  filters: FacultyListFilters,
) {
  let results = rows;

  if (filters.collegeNames?.length) {
    const allowed = new Set(
      filters.collegeNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
    );
    results = results.filter((r) => {
      const college = r.college.trim().toLowerCase();
      // Unmapped / blank HRMS college cannot be safely scoped — exclude for scoped users.
      return college && college !== "—" && allowed.has(college);
    });
  }
  if (filters.division) {
    const division = filters.division.toLowerCase();
    results = results.filter((r) => r.division.toLowerCase().includes(division));
  }
  if (filters.department) {
    const dept = filters.department.toLowerCase();
    results = results.filter((r) => r.department.toLowerCase().includes(dept));
  }
  if (filters.linkStatus && filters.linkStatus !== "all") {
    results = results.filter((r) => r.linkStatus === filters.linkStatus);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.hrmsEmployeeId.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.division.toLowerCase().includes(q) ||
        r.employeeGroup.toLowerCase().includes(q),
    );
  }

  return results;
}

export async function listFaculty(filters: FacultyListFilters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 25));

  const [allRows, groupFilter] = await Promise.all([
    loadFacultyRows(),
    getFacultyGroupFilter(),
  ]);
  const filtered = applyFacultyFilters(allRows, filters);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  const linkedCount = filtered.filter((r) => r.linkStatus === "linked").length;
  const kpiSource = filters.collegeNames ? filtered : allRows;
  const kpiLinked = kpiSource.filter((r) => r.linkStatus === "linked").length;

  return {
    data,
    enabledGroupCount: groupFilter.enabledIds.size,
    usingDefaultGroups: !groupFilter.configured,
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
    kpis: {
      totalFaculty: kpiSource.length,
      linkedCount: kpiLinked,
      unlinkedCount: kpiSource.length - kpiLinked,
    },
    filterOptions: {
      divisions: [...new Set(kpiSource.map((r) => r.division))].sort(),
      departments: [...new Set(kpiSource.map((r) => r.department))].sort(),
    },
    scopeLimitation:
      filters.collegeNames != null
        ? "Faculty college scope uses HRMS college name matched to Student DB college names; staff without a resolvable college name are excluded. Branch scope is not available from HRMS."
        : undefined,
  };
}

// ─── listDepartments ────────────────────────────────────────────────────────────

export async function listDepartmentsWithFaculty() {
  const [allRows, groupFilter] = await Promise.all([
    loadFacultyRows(),
    getFacultyGroupFilter(),
  ]);

  const deptMap = new Map<string, number>();
  for (const emp of allRows) {
    const division = emp.division === "—" ? "Unassigned Division" : emp.division;
    const dept = emp.department === "—" ? "Unassigned Department" : emp.department;
    const key = `${division}__${dept}`;
    deptMap.set(key, (deptMap.get(key) ?? 0) + 1);
  }

  const data = Array.from(deptMap.entries())
    .map(([key, facultyCount]) => {
      const [division, name] = key.split("__");
      return {
        id: encodeURIComponent(key),
        key,
        name,
        division,
        facultyCount,
      };
    })
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      return byName !== 0 ? byName : a.division.localeCompare(b.division);
    });

  const linkedCount = allRows.filter((r) => r.linkStatus === "linked").length;

  return {
    data,
    enabledGroupCount: groupFilter.enabledIds.size,
    usingDefaultGroups: !groupFilter.configured,
    kpis: {
      totalFaculty: allRows.length,
      linkedCount,
      unlinkedCount: allRows.length - linkedCount,
      departmentCount: data.length,
    },
  };
}

// ─── getFacultyDetail ───────────────────────────────────────────────────────────

export async function getFacultyDetail(hrmsEmployeeId: string) {
  const db = await getHrmsDb();
  const lookups = await loadHrmsOrgLookups(db);

  // HRMS record
  const empDoc = await db.collection("employees").findOne({
    $or: [
      { emp_no: hrmsEmployeeId },
      { employeeId: hrmsEmployeeId },
      { employeeCode: hrmsEmployeeId },
      { empCode: hrmsEmployeeId },
    ],
  });

  const hrms = empDoc
    ? extractHrmsStaffProfile(empDoc as Record<string, unknown>, lookups)
    : null;

  // ap_staff_link
  const linkRows = await queryAcademic<StaffLinkRow[]>(
    `SELECT id, hrms_employee_id, employee_code, display_name, department_name
     FROM ap_staff_link WHERE hrms_employee_id = ? LIMIT 1`,
    [hrmsEmployeeId],
  );
  const link = linkRows[0] ?? null;

  if (!hrms && !link) return null;

  const staffLinkId = link ? Number(link.id) : null;
  const name = hrms?.name ?? link?.display_name?.trim() ?? hrmsEmployeeId;
  const division = hrms?.division ?? "—";
  const department = hrms?.department ?? link?.department_name?.trim() ?? "—";
  const designation = hrms?.designation ?? "—";
  const college = hrms?.college ?? "—";
  const employeeGroup = hrms?.employeeGroup ?? "—";

  // Published timetable assignments
  let assignments: {
    entryId: number;
    planId: number;
    dayOfWeek: string;
    entryType: string;
    subjectCode: string | null;
    subjectName: string | null;
    section: string | null;
    batch: string;
    year: number | null;
    semester: number | null;
    collegeId: number;
    courseId: number;
    branchId: number;
    branchName: string | null;
    academicYear: string;
    slotLabel: string | null;
    startTime: string | null;
    endTime: string | null;
    minutes: number;
    roomLabel: string | null;
  }[] = [];

  let workload: {
    periodsPerWeek: number;
    minutesPerWeek: number;
    hoursPerWeek: number;
    theory: number;
    lab: number;
    subjects: number;
    sections: number;
  } | null = null;

  if (staffLinkId) {
    const rows = await queryAcademic<EntryRow[]>(
      `SELECT
         e.id AS entry_id, e.plan_id, e.day_of_week, e.entry_type,
         e.subject_code, e.subject_name,
         p.section_name, p.batch, p.year_of_study, p.semester_number,
         p.college_id, p.course_id, p.branch_id, p.academic_year_label,
         ts.label AS slot_label, ts.start_time, ts.end_time,
         e.room_label
       FROM ap_timetable_entries e
       INNER JOIN ap_timetable_plans p ON p.id = e.plan_id AND p.status = 'published'
       INNER JOIN ap_timing_template_slots ts
         ON ts.id = COALESCE(e.timing_slot_id, e.period_slot_id)
         AND ts.slot_type = 'CLASS'
       WHERE e.faculty_staff_link_id = ?
       ORDER BY p.academic_year_label DESC, e.day_of_week, ts.start_time`,
      [staffLinkId],
    );

    const branchIds = [...new Set(rows.map((row) => Number(row.branch_id)).filter((id) => id > 0))];
    const branchNames = new Map<number, string>();
    if (branchIds.length > 0) {
      const branchRows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
        `SELECT id, name FROM course_branches WHERE id IN (${branchIds.map(() => "?").join(",")})`,
        branchIds,
      );
      for (const branch of branchRows) {
        branchNames.set(Number(branch.id), String(branch.name ?? "").trim());
      }
    }

    assignments = rows.map((row) => {
      const mins = slotDurationMinutes(row.start_time, row.end_time);
      const branchId = Number(row.branch_id);
      return {
        entryId: Number(row.entry_id),
        planId: Number(row.plan_id),
        dayOfWeek: row.day_of_week,
        entryType: row.entry_type,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        section: row.section_name,
        batch: row.batch,
        year: row.year_of_study,
        semester: row.semester_number,
        collegeId: Number(row.college_id),
        courseId: Number(row.course_id),
        branchId,
        branchName: branchNames.get(branchId) ?? null,
        academicYear: row.academic_year_label,
        slotLabel: row.slot_label,
        startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
        endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
        minutes: mins,
        roomLabel: row.room_label,
      };
    });

    if (assignments.length > 0) {
      const totalMin = assignments.reduce((s, a) => s + a.minutes, 0);
      const theory = assignments.filter((a) => a.entryType === "theory").length;
      const lab = assignments.filter((a) => a.entryType === "lab").length;
      const subjects = new Set(assignments.map((a) => a.subjectCode ?? "")).size;
      const sections = new Set(
        assignments.map((a) => `${a.collegeId}:${a.section ?? ""}:${a.batch}`),
      ).size;
      workload = {
        periodsPerWeek: assignments.length,
        minutesPerWeek: totalMin,
        hoursPerWeek: Math.round((totalMin / 60) * 10) / 10,
        theory,
        lab,
        subjects,
        sections,
      };
    }
  }

  return {
    hrmsEmployeeId,
    staffLinkId,
    name,
    code: link?.employee_code ?? hrmsEmployeeId,
    division,
    department,
    designation,
    college,
    employeeGroup,
    isActive: hrms?.isActive ?? true,
    linkStatus: link ? "linked" : "unlinked",
    assignments,
    workload,
    source:
      assignments.length > 0
        ? "Published timetable entries (ap_timetable_entries + ap_timing_template_slots)"
        : "No published timetable assignments found.",
  };
}

// ─── getDepartmentDetail ────────────────────────────────────────────────────────

export async function getDepartmentDetail(departmentKey: string) {
  const [division, departmentName] = departmentKey.split("__");
  const result = await listFaculty({
    division,
    department: departmentName,
    page: 1,
    pageSize: 500,
  });
  const faculty = result.data;
  const linkedCount = faculty.filter((f) => f.linkStatus === "linked").length;

  return {
    key: departmentKey,
    division,
    name: departmentName,
    facultyCount: faculty.length,
    linkedCount,
    unlinkedCount: faculty.length - linkedCount,
    faculty,
  };
}
