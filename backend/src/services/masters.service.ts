import type { RowDataPacket } from "mysql2";
import { queryStudent } from "../db/pools.js";

type CollegeRow = RowDataPacket & {
  id: number;
  name: string;
  code: string | null;
  is_active: number | null;
};

type YearRow = RowDataPacket & {
  id: number;
  year_label: string;
  is_active: number | null;
};

type CourseRow = RowDataPacket & {
  id: number;
  name: string;
  code: string | null;
  college_id: number;
  is_active: number | null;
  total_years: number | null;
  semesters_per_year: number | null;
  year_semester_config: unknown;
};

type BranchRow = RowDataPacket & {
  id: number;
  name: string;
  code: string | null;
  course_id: number;
  is_active: number | null;
  metadata: unknown;
};

type AssignedSectionRow = RowDataPacket & {
  branch_id: number;
  section_name: string;
  student_count: number;
};

type BranchSectionMeta = {
  name: string;
  strength?: number;
};

type YearSemesterConfigItem = {
  year: number;
  semesters: number;
};

function parseBranchSections(metadata: unknown): {
  enabled: boolean;
  items: BranchSectionMeta[];
} {
  let parsed: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return { enabled: false, items: [] };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { enabled: false, items: [] };
  }

  const root = parsed as Record<string, unknown>;
  const sections = root.sections;
  if (!sections || typeof sections !== "object") {
    return { enabled: false, items: [] };
  }

  const sectionObj = sections as Record<string, unknown>;
  const enabled = Boolean(sectionObj.enabled);
  const rawItems = Array.isArray(sectionObj.items) ? sectionObj.items : [];
  const items = rawItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = String((item as Record<string, unknown>).name ?? "").trim();
      if (!name) return null;
      const strengthRaw = (item as Record<string, unknown>).strength;
      const strength =
        typeof strengthRaw === "number"
          ? strengthRaw
          : Number(strengthRaw) || undefined;
      return { name, strength };
    })
    .filter((item): item is BranchSectionMeta => Boolean(item));

  return { enabled, items };
}

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
      const year = Number((item as Record<string, unknown>).year);
      const semesters = Number((item as Record<string, unknown>).semesters);
      if (!Number.isFinite(year) || year < 1) return null;
      if (!Number.isFinite(semesters) || semesters < 1) return null;
      return { year, semesters };
    })
    .filter((item): item is YearSemesterConfigItem => Boolean(item))
    .sort((a, b) => a.year - b.year);
}

function buildCourseYearOptions(
  totalYears: number,
  config: YearSemesterConfigItem[],
) {
  if (config.length > 0) {
    return config.map((item) => item.year);
  }
  const years: number[] = [];
  for (let y = 1; y <= totalYears; y += 1) years.push(y);
  return years;
}

export function parseStartYear(label: string): number {
  const match = String(label ?? "").match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
}

export function getCurrentAcademicYearLabel(now = new Date()): string {
  const currentYear = now.getFullYear();
  // Academic sessions start around June in India (month 5+).
  const startYear = now.getMonth() >= 5 ? currentYear : currentYear - 1;
  return `${startYear}-${startYear + 1}`;
}

export async function getAcademicMasters() {
  const [
    colleges,
    years,
    courses,
    branches,
    assignedSections,
    studentBatchRows,
    sectionBatchRows,
  ] = await Promise.all([
      queryStudent<CollegeRow[]>(
        `
        SELECT id, name, code, is_active
        FROM colleges
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name
        `,
      ),
      queryStudent<YearRow[]>(
        `
        SELECT id, year_label, is_active
        FROM academic_years
        ORDER BY is_active DESC, id DESC
        `,
      ),
      queryStudent<CourseRow[]>(
        `
        SELECT
          id, name, code, college_id, is_active,
          total_years, semesters_per_year, year_semester_config
        FROM courses
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name
        `,
      ),
      queryStudent<BranchRow[]>(
        `
        SELECT id, name, code, course_id, is_active, metadata
        FROM course_branches
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name
        `,
      ),
      queryStudent<AssignedSectionRow[]>(
        `
        SELECT
          branch_id,
          TRIM(section_name) AS section_name,
          COUNT(*) AS student_count
        FROM student_sections
        WHERE section_name IS NOT NULL AND TRIM(section_name) <> ''
        GROUP BY branch_id, TRIM(section_name)
        `,
      ),
      // Primary batch source (works for branches without sections, e.g. M.Tech)
      queryStudent<(RowDataPacket & { branch_id: number; batch: string })[]>(
        `
        SELECT branch_id, TRIM(batch) AS batch
        FROM students
        WHERE batch IS NOT NULL AND TRIM(batch) <> ''
        GROUP BY branch_id, TRIM(batch)
        ORDER BY batch DESC
        `,
      ),
      queryStudent<(RowDataPacket & { branch_id: number; batch: string })[]>(
        `
        SELECT branch_id, TRIM(batch) AS batch
        FROM student_sections
        WHERE batch IS NOT NULL AND TRIM(batch) <> ''
        GROUP BY branch_id, TRIM(batch)
        ORDER BY batch DESC
        `,
      ),
    ]);

  const assignedMap = new Map<string, number>();
  for (const row of assignedSections) {
    assignedMap.set(`${row.branch_id}::${row.section_name}`, Number(row.student_count));
  }

  const sortedYears = [...years].sort((a, b) => {
    const aStart = parseStartYear(a.year_label);
    const bStart = parseStartYear(b.year_label);
    if (aStart !== bStart) return bStart - aStart;
    return b.id - a.id;
  });

  const currentCalYear = getCurrentAcademicYearLabel();
  const currentMatch =
    sortedYears.find((y) => y.year_label === currentCalYear && Number(y.is_active) === 1) ||
    sortedYears.find((y) => y.year_label === currentCalYear);

  const activeYear =
    currentMatch?.year_label ??
    sortedYears.find(
      (y) =>
        Number(y.is_active) === 1 && parseStartYear(y.year_label) <= new Date().getFullYear(),
    )?.year_label ??
    sortedYears.find((y) => Number(y.is_active) === 1)?.year_label ??
    sortedYears[0]?.year_label ??
    "—";

  const sections: Array<{
    branchId: number;
    name: string;
    batch: string;
    studentCount: number;
    strength: number | null;
  }> = [];

  const branchPayload = branches.map((b) => {
    const parsed = parseBranchSections(b.metadata);
    const hasSections = parsed.enabled && parsed.items.length > 0;

    if (hasSections) {
      for (const item of parsed.items) {
        sections.push({
          branchId: b.id,
          name: item.name,
          batch: "",
          studentCount: assignedMap.get(`${b.id}::${item.name}`) ?? 0,
          strength: item.strength ?? null,
        });
      }
    }

    return {
      id: b.id,
      name: b.name,
      code: b.code,
      courseId: b.course_id,
      hasSections,
      sectionCount: hasSections ? parsed.items.length : 0,
    };
  });

  const batchSet = new Map<string, { branchId: number; batch: string }>();
  for (const row of [...studentBatchRows, ...sectionBatchRows]) {
    const batch = String(row.batch).trim();
    if (!batch) continue;
    batchSet.set(`${row.branch_id}::${batch}`, {
      branchId: row.branch_id,
      batch,
    });
  }
  const batches = Array.from(batchSet.values()).sort((a, b) =>
    b.batch.localeCompare(a.batch),
  );

  const coursePayload = courses.map((c) => {
    const totalYears = Math.max(1, Number(c.total_years) || 4);
    const semestersPerYear = Math.max(1, Number(c.semesters_per_year) || 2);
    const yearSemesterConfig = parseYearSemesterConfig(c.year_semester_config);
    const yearOptions = buildCourseYearOptions(totalYears, yearSemesterConfig);

    return {
      id: c.id,
      name: c.name,
      code: c.code,
      collegeId: c.college_id,
      totalYears,
      semestersPerYear,
      yearSemesterConfig,
      yearOptions,
    };
  });

  return {
    academicYears: sortedYears.map((y) => ({
      id: y.id,
      label: y.year_label,
      isActive: Number(y.is_active) === 1,
    })),
    colleges: colleges.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
    })),
    courses: coursePayload,
    branches: branchPayload,
    sections,
    batches,
    // Global fallbacks when no course is selected
    yearOptions: [1, 2, 3, 4],
    semesterOptions: [1, 2],
    defaults: {
      academicYear: activeYear,
      collegeId: null as number | null,
      collegeName: "All Colleges",
    },
  };
}

/**
 * Most common year + semester among Regular students in a batch scope.
 * Used to prefill Timetable filters from live student_database progress.
 */
export async function resolveBatchAcademicProgress(input: {
  collegeId: number;
  courseId: number;
  branchId: number;
  batch: string;
}) {
  const batch = input.batch.trim();
  if (!batch) {
    return { year: null, semester: null, studentCount: 0 };
  }

  const rows = await queryStudent<
    (RowDataPacket & {
      current_year: number;
      current_semester: number;
      student_count: number;
    })[]
  >(
    `
    SELECT
      s.current_year,
      s.current_semester,
      COUNT(*) AS student_count
    FROM students s
    WHERE s.college_id = ?
      AND s.course_id = ?
      AND s.branch_id = ?
      AND TRIM(s.batch) = ?
      AND TRIM(COALESCE(s.student_status, '')) COLLATE utf8mb4_unicode_ci
          = 'Regular' COLLATE utf8mb4_unicode_ci
      AND s.current_year IS NOT NULL
      AND s.current_semester IS NOT NULL
    GROUP BY s.current_year, s.current_semester
    ORDER BY student_count DESC, s.current_year DESC, s.current_semester DESC
    LIMIT 1
    `,
    [input.collegeId, input.courseId, input.branchId, batch],
  );

  const match = rows[0];
  if (!match) {
    return { year: null, semester: null, studentCount: 0 };
  }

  return {
    year: Number(match.current_year),
    semester: Number(match.current_semester),
    studentCount: Number(match.student_count),
  };
}
