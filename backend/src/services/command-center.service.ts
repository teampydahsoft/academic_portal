import type { RowDataPacket } from "mysql2";
import { queryStudent, queryExam, getHrmsDb } from "../db/pools.js";
import { getTimetableCoverage } from "./timetables.service.js";
import { getTodaySessionCounts } from "./attendance.service.js";

type CountRow = RowDataPacket & { total: number };
type AvgRow = RowDataPacket & { avg_pct: number | null };
type BranchMetaRow = RowDataPacket & {
  id: number;
  metadata: unknown;
};
type CollegeNameRow = RowDataPacket & { id: number; name: string };

export type CommandCenterFilters = {
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  section?: string;
};

function parseConfiguredSectionCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const sections = (metadata as Record<string, unknown>).sections;
  if (!sections || typeof sections !== "object") return 0;
  const sectionObj = sections as Record<string, unknown>;
  if (!sectionObj.enabled || !Array.isArray(sectionObj.items)) return 0;
  return sectionObj.items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return String((item as Record<string, unknown>).name ?? "").trim() !== "";
  }).length;
}

function buildStudentWhere(filters: CommandCenterFilters) {
  const where: string[] = [
    `(s.student_status IS NULL OR LOWER(s.student_status) NOT IN ('relieved', 'discontinued', 'inactive', 'cancelled'))`,
  ];
  const params: unknown[] = [];

  if (filters.collegeId) {
    where.push("s.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`s.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.courseId) {
    where.push("s.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("s.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`s.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.section && filters.section !== "all") {
    where.push(
      `(TRIM(IFNULL(s.section, '')) = ? OR EXISTS (
          SELECT 1 FROM student_sections ss
          WHERE ss.student_id = s.id AND TRIM(ss.section_name) = ?
        ))`,
    );
    params.push(filters.section, filters.section);
  }

  return { whereSql: where.join(" AND "), params };
}

async function resolveCollegeNames(filters: CommandCenterFilters): Promise<string[] | null> {
  const ids =
    filters.collegeId != null
      ? [filters.collegeId]
      : filters.collegeIds?.length
        ? filters.collegeIds
        : null;
  if (!ids) return null;
  const rows = await queryStudent<CollegeNameRow[]>(
    `SELECT id, name FROM colleges WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return rows.map((r) => String(r.name).trim()).filter(Boolean);
}

async function countConfiguredSections(filters: CommandCenterFilters) {
  if (filters.section && filters.section !== "all") {
    return 1;
  }

  const where: string[] = ["(cb.is_active = 1 OR cb.is_active IS NULL)"];
  const params: unknown[] = [];

  if (filters.branchId) {
    where.push("cb.id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`cb.id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  } else if (filters.courseId) {
    where.push("cb.course_id = ?");
    params.push(filters.courseId);
  } else if (filters.collegeId) {
    where.push("cb.course_id IN (SELECT id FROM courses WHERE college_id = ?)");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(
      `cb.course_id IN (SELECT id FROM courses WHERE college_id IN (${filters.collegeIds
        .map(() => "?")
        .join(",")}))`,
    );
    params.push(...filters.collegeIds);
  }

  const rows = await queryStudent<BranchMetaRow[]>(
    `
    SELECT cb.id, cb.metadata
    FROM course_branches cb
    WHERE ${where.join(" AND ")}
    `,
    params,
  );

  return rows.reduce((sum, row) => sum + parseConfiguredSectionCount(row.metadata), 0);
}

async function countActiveExams(filters: CommandCenterFilters) {
  const collegeNames = await resolveCollegeNames(filters);
  if (collegeNames == null) {
    const rows = await queryExam<CountRow[]>(
      `SELECT COUNT(*) AS total FROM exams WHERE LOWER(status) NOT IN ('cancelled', 'archived')`,
    );
    return Number(rows[0]?.total ?? 0);
  }
  if (!collegeNames.length) return 0;

  const placeholders = collegeNames.map(() => "?").join(",");
  const rows = await queryExam<CountRow[]>(
    `
    SELECT COUNT(DISTINCT e.id) AS total
    FROM exams e
    LEFT JOIN exam_scopes s ON s.examId = e.id
    WHERE LOWER(e.status) NOT IN ('cancelled', 'archived')
      AND (
        LOWER(TRIM(COALESCE(s.college, ''))) IN (${placeholders})
        OR (
          s.id IS NULL
          AND LOWER(TRIM(COALESCE(e.college, ''))) IN (${placeholders})
        )
      )
    `,
    [...collegeNames.map((n) => n.toLowerCase()), ...collegeNames.map((n) => n.toLowerCase())],
  );
  return Number(rows[0]?.total ?? 0);
}

async function countFaculty(filters: CommandCenterFilters) {
  const collegeNames = await resolveCollegeNames(filters);
  try {
    const db = await getHrmsDb();
    const employees = await db
      .collection("employees")
      .find({
        $or: [{ status: { $exists: false } }, { status: { $ne: "Inactive" } }],
      })
      .project({ college: 1, collegeName: 1, college_name: 1 })
      .limit(5000)
      .toArray();

    if (collegeNames == null) return employees.length;

    const allowed = new Set(collegeNames.map((n) => n.toLowerCase()));
    return employees.filter((emp) => {
      const raw =
        (emp as { college?: unknown; collegeName?: unknown; college_name?: unknown }).college ??
        (emp as { collegeName?: unknown }).collegeName ??
        (emp as { college_name?: unknown }).college_name;
      const name = String(raw ?? "")
        .trim()
        .toLowerCase();
      return name && allowed.has(name);
    }).length;
  } catch {
    return 0;
  }
}

export async function getCommandCenterSummary(filters: CommandCenterFilters = {}) {
  const { whereSql, params } = buildStudentWhere(filters);

  const [
    activeStudentsRows,
    attendanceAvgRows,
    belowThresholdRows,
    activeExams,
    facultyCount,
    timetableCoverage,
    configuredSections,
    todaySessions,
  ] = await Promise.all([
    queryStudent<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM students s
       WHERE ${whereSql}`,
      params,
    ),
    queryStudent<AvgRow[]>(
      `
      SELECT ROUND(
        SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN ar.status IN ('present','absent') THEN 1 ELSE 0 END), 0),
        1
      ) AS avg_pct
      FROM attendance_records ar
      INNER JOIN students s ON s.id = ar.student_id
      WHERE ${whereSql}
        AND ar.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND ar.status IN ('present', 'absent')
      `,
      params,
    ),
    queryStudent<CountRow[]>(
      `
      SELECT COUNT(*) AS total FROM (
        SELECT ar.student_id,
          SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
          NULLIF(SUM(CASE WHEN ar.status IN ('present','absent') THEN 1 ELSE 0 END), 0) AS pct
        FROM attendance_records ar
        INNER JOIN students s ON s.id = ar.student_id
        WHERE ${whereSql}
          AND ar.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        GROUP BY ar.student_id
        HAVING pct < 75
      ) risk
      `,
      params,
    ),
    countActiveExams(filters),
    countFaculty(filters),
    getTimetableCoverage({
      collegeId: filters.collegeId,
      collegeIds: filters.collegeIds,
      branchId: filters.branchId,
      branchIds: filters.branchIds,
      section: filters.section,
    }),
    countConfiguredSections(filters),
    getTodaySessionCounts({
      collegeId: filters.collegeId,
      collegeIds: filters.collegeIds,
      branchId: filters.branchId,
      branchIds: filters.branchIds,
    }),
  ]);

  const activeStudents = Number(activeStudentsRows[0]?.total ?? 0);
  const averageAttendance = Number(attendanceAvgRows[0]?.avg_pct ?? 0);
  const studentsBelowThreshold = Number(belowThresholdRows[0]?.total ?? 0);
  const sectionCount = configuredSections;

  return {
    activeStudents,
    sectionCount,
    timetablesPublished: {
      published: Number(timetableCoverage.published ?? 0),
      total: Math.max(sectionCount, Number(timetableCoverage.totalPlans ?? 0), 0),
    },
    facultyCount,
    facultyExceptions: 0,
    attendancePendingToday: Number(todaySessions.pending ?? 0),
    averageAttendance,
    studentsBelowThreshold,
    openRiskCases: studentsBelowThreshold,
    examReadiness: activeExams > 0 ? "Exams configured" : "No active exams",
    activeExams,
    classesToday: {
      scheduled: Number(todaySessions.scheduled ?? 0),
      posted: Number(todaySessions.posted ?? 0),
      pending: Number(todaySessions.pending ?? 0),
    },
    appliedFilters: filters,
    source: {
      students: "student_database",
      staff: "hrms",
      exams: "examination_portal",
      timetables: "academic_portal",
      sections: "course_branches.metadata.sections",
    },
  };
}
