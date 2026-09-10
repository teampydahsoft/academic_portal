import type { RowDataPacket } from "mysql2";
import {
  executeAcademic,
  getHrmsDb,
  queryAcademic,
  queryExam,
  queryStudent,
  withAcademicTransaction,
} from "../db/pools.js";
import {
  DAY_CODE_TO_LABEL,
  DAY_LABEL_TO_CODE,
  getActiveTimingForContext,
  getTimingTemplateDetail,
  listTimingSlots,
  type DayCode,
} from "./timing.service.js";
import {
  extractHrmsStaffProfile,
  HRMS_EMPLOYEE_PROJECTION,
  isTeachingGroup,
  loadHrmsOrgLookups,
} from "./hrms-staff.service.js";
import {
  employeeMatchesFacultyGroupFilter,
  getFacultyGroupFilter,
} from "./portal-settings.service.js";
import {
  ensureStaffUserForSubjectAssignment,
  syncStaffUserRolesForTimetableChanges,
} from "./user-management.service.js";
import type { PoolConnection } from "mysql2/promise";

export type TimetablePlannerFilters = {
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  section?: string;
  batch?: string;
  year?: number;
  semester?: number;
  academicYear?: string;
};

type ContextRow = RowDataPacket & {
  college_id: number;
  college_name: string;
  course_id: number;
  course_name: string;
  branch_id: number;
  branch_name: string;
  metadata: unknown;
};

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
  notes: string | null;
};

type EntryRow = RowDataPacket & {
  id: number;
  plan_id: number;
  day_of_week: DayCode;
  timing_slot_id: number | null;
  period_slot_id: number;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  subject_type_snapshot: string | null;
  entry_type: string;
  faculty_staff_link_id: number | null;
  room_label: string | null;
  custom_label: string | null;
  faculty_name?: string | null;
  faculty_hrms_id?: string | null;
};

export type AssignmentInput = {
  dayOfWeek: DayCode | string;
  timingSlotId: number;
  subjectId?: number | null;
  subjectCode?: string | null;
  subjectName?: string | null;
  subjectTypeSnapshot?: string | null;
  entryType?: "theory" | "lab" | "other";
  facultyStaffLinkId?: number | null;
  hrmsEmployeeId?: string | null;
  facultyName?: string | null;
  roomLabel?: string | null;
  /** Label for free/special periods (CRT, Games, Library, etc.) */
  customLabel?: string | null;
};

/** Free/special period: labeled activity without an EMS subject (CRT, Games, etc.). */
export function isFreePeriodAssignment(a: {
  subjectId?: number | null;
  customLabel?: string | null;
}): boolean {
  const label = (a.customLabel ?? "").trim();
  const subjectId = a.subjectId == null ? 0 : Number(a.subjectId);
  return label.length > 0 && (!Number.isFinite(subjectId) || subjectId <= 0);
}

export function isAssignedEntry(entry: {
  subject_id?: number | null;
  faculty_staff_link_id?: number | null;
  custom_label?: string | null;
}): boolean {
  if ((entry.custom_label ?? "").trim()) return true;
  return Boolean(entry.subject_id && entry.faculty_staff_link_id);
}

export type EmsSubject = {
  id: number;
  code: string;
  name: string;
  type: string;
};

/** Map EMS subject.type → timetable entry_type */
export function mapEmsTypeToEntryType(
  emsType: string | null | undefined,
): "theory" | "lab" | "other" {
  const t = (emsType ?? "").trim().toLowerCase();
  if (t === "practical" || t === "lab" || t === "practicals") return "lab";
  if (t === "theory") return "theory";
  return "other";
}

function branchHasConfiguredSections(metadata: unknown): boolean {
  let parsed: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== "object") return false;
  const sections = (parsed as Record<string, unknown>).sections;
  if (!sections || typeof sections !== "object") return false;
  const sectionObj = sections as Record<string, unknown>;
  return (
    Boolean(sectionObj.enabled) &&
    Array.isArray(sectionObj.items) &&
    sectionObj.items.length > 0
  );
}

function toDayCode(value: string): DayCode {
  if (value in DAY_CODE_TO_LABEL) return value as DayCode;
  const mapped = DAY_LABEL_TO_CODE[value];
  if (!mapped) throw new Error(`Invalid day: ${value}`);
  return mapped;
}

async function resolveContext(filters: TimetablePlannerFilters) {
  if (!filters.branchId) return null;
  const rows = await queryStudent<ContextRow[]>(
    `
    SELECT
      col.id AS college_id,
      col.name AS college_name,
      c.id AS course_id,
      c.name AS course_name,
      cb.id AS branch_id,
      cb.name AS branch_name,
      cb.metadata
    FROM course_branches cb
    INNER JOIN courses c ON c.id = cb.course_id
    INNER JOIN colleges col ON col.id = c.college_id
    WHERE cb.id = ?
    LIMIT 1
    `,
    [filters.branchId],
  );
  const row = rows[0];
  if (!row) return null;
  if (filters.collegeId && row.college_id !== filters.collegeId) return null;
  if (filters.courseId && row.course_id !== filters.courseId) return null;
  return {
    collegeId: row.college_id,
    collegeName: row.college_name,
    courseId: row.course_id,
    courseName: row.course_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    hasSections: branchHasConfiguredSections(row.metadata),
  };
}

async function countStudentsForScope(filters: TimetablePlannerFilters) {
  if (!filters.branchId) return 0;
  const where = [
    "s.branch_id = ?",
    `(s.student_status IS NULL OR LOWER(s.student_status) NOT IN ('relieved','discontinued','inactive','cancelled'))`,
  ];
  const params: unknown[] = [filters.branchId];
  if (filters.batch) {
    where.push("s.batch = ?");
    params.push(filters.batch);
  }
  if (filters.year) {
    where.push("s.current_year = ?");
    params.push(filters.year);
  }
  if (filters.section && filters.section !== "all") {
    where.push(
      `(TRIM(IFNULL(s.section,'')) = ? OR EXISTS (
        SELECT 1 FROM student_sections ss
        WHERE ss.student_id = s.id AND TRIM(ss.section_name) = ?
      ))`,
    );
    params.push(filters.section, filters.section);
  }
  const rows = await queryStudent<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM students s WHERE ${where.join(" AND ")}`,
    params,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function ensureStaffLink(input: {
  hrmsEmployeeId: string;
  displayName?: string | null;
  departmentName?: string | null;
  employeeCode?: string | null;
}) {
  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_staff_link WHERE hrms_employee_id = ? LIMIT 1`,
    [input.hrmsEmployeeId],
  );
  if (existing[0]?.id) return existing[0].id;

  const result = await executeAcademic(
    `
    INSERT INTO ap_staff_link (hrms_employee_id, employee_code, display_name, department_name)
    VALUES (?, ?, ?, ?)
    `,
    [
      input.hrmsEmployeeId,
      input.employeeCode ?? null,
      input.displayName ?? null,
      input.departmentName ?? null,
    ],
  );
  return Number(result.insertId);
}

export async function listFacultyOptions(limit = 500) {
  try {
    const db = await getHrmsDb();
    const lookups = await loadHrmsOrgLookups(db);
    const groupFilter = await getFacultyGroupFilter();
    const employees = await db
      .collection("employees")
      .find({
        $or: [{ is_active: true }, { is_active: { $exists: false } }],
      })
      .project(HRMS_EMPLOYEE_PROJECTION)
      .limit(limit * 4)
      .toArray();

    const mapped = employees
      .map((raw) => extractHrmsStaffProfile(raw as Record<string, unknown>, lookups))
      .filter(
        (staff) =>
          employeeMatchesFacultyGroupFilter(
            groupFilter,
            staff.employeeGroupId,
            staff.employeeGroup,
          ) || isTeachingGroup(staff.employeeGroup),
      )
      .map((staff) => ({
        hrmsEmployeeId: staff.hrmsId,
        name: staff.name,
        division: staff.division,
        department: staff.department,
        designation: staff.designation,
        employeeGroup: staff.employeeGroup,
      }))
      .slice(0, limit);

    return mapped.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function listSubjectsForPlanner(filters: TimetablePlannerFilters) {
  // Curriculum-correct list: subject_mapping_entries is authoritative for
  // which subjects belong to a college/course/branch/batch/year/semester.
  // `subjects` remains the master for id/code/name/type.
  const collegeId = filters.collegeId;
  const courseId = filters.courseId;
  const branchId = filters.branchId;
  const batch = filters.batch?.trim();

  if (!collegeId || !courseId || !branchId || !batch) {
    return [];
  }

  const where: string[] = [
    "sme.collegeId = ?",
    "sme.courseId = ?",
    "sme.branchId = ?",
    "sme.batch = ?",
    "(s.status = 'active' OR s.status IS NULL OR s.status = '')",
  ];
  const params: unknown[] = [collegeId, courseId, branchId, batch];

  if (filters.year != null) {
    where.push("sme.yearOfStudy = ?");
    params.push(filters.year);
  }
  if (filters.semester != null) {
    where.push("sme.semester = ?");
    params.push(filters.semester);
  }

  const section = filters.section?.trim();
  if (section) {
    where.push(`
      (
        sme.sectionMode = 'all'
        OR sme.sectionKey = '*'
        OR sme.sectionKey = ?
        OR sme.sections IS NULL
        OR sme.sections = ''
        OR sme.sections LIKE CONCAT('%', ?, '%')
      )
    `);
    params.push(section, section);
  }

  const rows = await queryExam<
    (RowDataPacket & {
      id: number;
      code: string;
      name: string;
      type: string;
      semester: number | null;
      yearOfStudy: number | null;
      branchName: string | null;
      courseName: string | null;
      collegeName: string | null;
      batch: string | null;
      regulationId: number;
      mappingId: number;
    })[]
  >(
    `
    SELECT
      s.id,
      s.code,
      s.name,
      s.type,
      sme.semester,
      sme.yearOfStudy,
      sme.branchName,
      sme.courseName,
      sme.collegeName,
      sme.batch,
      sme.regulationId,
      sme.id AS mappingId
    FROM subject_mapping_entries sme
    INNER JOIN subjects s ON s.id = sme.subjectId
    WHERE ${where.join(" AND ")}
    ORDER BY s.code, sme.id
    LIMIT 300
    `,
    params,
  );

  // Deduplicate by subject id (same paper can appear once per mapping row)
  const seen = new Set<number>();
  const subjects: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    semester: number | null;
    year: number | null;
    branch: string | null;
    course: string | null;
    college: string | null;
    batch: string | null;
    regulationId: number;
    mappingId: number;
    source: "ems.subject_mapping_entries";
  }> = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    subjects.push({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      semester: row.semester,
      year: row.yearOfStudy,
      branch: row.branchName,
      course: row.courseName,
      college: row.collegeName,
      batch: row.batch,
      regulationId: row.regulationId,
      mappingId: row.mappingId,
      source: "ems.subject_mapping_entries",
    });
  }

  return subjects;
}

export async function getEmsSubjectsByIds(ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return new Map<number, EmsSubject>();

  const rows = await queryExam<
    (RowDataPacket & {
      id: number;
      code: string;
      name: string;
      type: string;
      status: string | null;
    })[]
  >(
    `
    SELECT id, code, name, type, status
    FROM subjects
    WHERE id IN (${unique.map(() => "?").join(",")})
    `,
    unique,
  );

  const map = new Map<number, EmsSubject>();
  for (const row of rows) {
    const status = (row.status ?? "active").toLowerCase();
    if (status && status !== "active") continue;
    map.set(row.id, {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
    });
  }
  return map;
}

/**
 * Resolve assignment subject fields from EMS (source of truth).
 * Client-provided code/name/type are ignored for subject classes.
 * Free/special periods (customLabel only) are passed through unchanged.
 */
export async function resolveAssignmentSubjectsFromEms(
  assignments: AssignmentInput[],
) {
  const ids = assignments
    .filter((a) => !isFreePeriodAssignment(a))
    .map((a) => Number(a.subjectId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const emsMap = await getEmsSubjectsByIds(ids);
  const missing = [...new Set(ids)].filter((id) => !emsMap.has(id));
  if (missing.length) {
    throw new Error(
      `EMS subject(s) not found or inactive: ${missing.join(", ")}`,
    );
  }

  return assignments.map((a) => {
    if (isFreePeriodAssignment(a)) {
      const customLabel = String(a.customLabel ?? "").trim();
      return {
        ...a,
        subjectId: null,
        subjectCode: null,
        subjectName: null,
        subjectTypeSnapshot: null,
        entryType: "other" as const,
        customLabel,
      };
    }
    const ems = emsMap.get(Number(a.subjectId))!;
    const mapped = mapEmsTypeToEntryType(ems.type);
    const entryType =
      a.entryType === "theory" || a.entryType === "lab" || a.entryType === "other"
        ? a.entryType
        : mapped;
    return {
      ...a,
      subjectId: ems.id,
      subjectCode: ems.code,
      subjectName: ems.name,
      subjectTypeSnapshot: ems.type,
      entryType,
      customLabel: null,
    };
  });
}

async function hydrateEntriesForDisplay(
  entries: EntryRow[],
  planStatus: string | null | undefined,
) {
  const liveStatuses = new Set(["draft", "in_review"]);
  if (!planStatus || !liveStatuses.has(planStatus)) {
    return entries;
  }

  const ids = entries
    .map((e) => e.subject_id)
    .filter((id): id is number => typeof id === "number" && id > 0);
  if (ids.length === 0) return entries;

  const emsMap = await getEmsSubjectsByIds(ids);
  return entries.map((entry) => {
    if (!entry.subject_id) return entry;
    const ems = emsMap.get(entry.subject_id);
    if (!ems) {
      return {
        ...entry,
        subject_name: entry.subject_name
          ? `${entry.subject_name} (EMS missing)`
          : "EMS subject missing",
      };
    }
    return {
      ...entry,
      subject_code: ems.code,
      subject_name: ems.name,
      subject_type_snapshot: ems.type,
    };
  });
}

async function refreshEntrySubjectSnapshots(
  planId: number,
  conn?: PoolConnection,
) {
  const query = async <T>(sql: string, params: unknown[] = []) => {
    if (conn) {
      const [rows] = await conn.query(sql, params as never);
      return rows as T;
    }
    return queryAcademic<T>(sql, params);
  };
  const exec = async (sql: string, params: unknown[] = []) => {
    if (conn) {
      await conn.execute(sql, params as never);
      return;
    }
    await executeAcademic(sql, params);
  };

  const rows = await query<EntryRow[]>(
    `
    SELECT id, subject_id, subject_code, subject_name, subject_type_snapshot, entry_type
    FROM ap_timetable_entries
    WHERE plan_id = ? AND subject_id IS NOT NULL
    `,
    [planId],
  );
  if (!rows.length) return { refreshed: 0 };

  const emsMap = await getEmsSubjectsByIds(
    rows.map((r) => Number(r.subject_id)),
  );
  const missing = rows
    .map((r) => Number(r.subject_id))
    .filter((id) => !emsMap.has(id));
  if (missing.length) {
    throw new Error(
      `Cannot publish: EMS subject(s) missing or inactive: ${[...new Set(missing)].join(", ")}`,
    );
  }

  let refreshed = 0;
  for (const row of rows) {
    const ems = emsMap.get(Number(row.subject_id))!;
    await exec(
      `
      UPDATE ap_timetable_entries
      SET subject_code = ?,
          subject_name = ?,
          subject_type_snapshot = ?
      WHERE id = ?
      `,
      [ems.code, ems.name, ems.type, row.id],
    );
    refreshed += 1;
  }
  return { refreshed };
}

async function findPlan(filters: Required<
  Pick<
    TimetablePlannerFilters,
    "collegeId" | "courseId" | "branchId" | "academicYear" | "batch" | "semester"
  >
> & { section?: string | null; year?: number | null; statuses?: string[] }) {
  const statuses = filters.statuses ?? ["draft", "in_review", "published"];
  const rows = await queryAcademic<PlanRow[]>(
    `
    SELECT *
    FROM ap_timetable_plans
    WHERE academic_year_label = ?
      AND college_id = ?
      AND course_id = ?
      AND branch_id = ?
      AND batch = ?
      AND semester_number = ?
      AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
      AND status IN (${statuses.map(() => "?").join(",")})
    ORDER BY
      FIELD(status,'draft','in_review','published'),
      version_no DESC,
      id DESC
    LIMIT 1
    `,
    [
      filters.academicYear,
      filters.collegeId,
      filters.courseId,
      filters.branchId,
      filters.batch,
      filters.semester,
      filters.section ?? null,
      filters.section ?? null,
      ...statuses,
    ],
  );
  return rows[0] ?? null;
}

async function loadEntries(planId: number) {
  const rows = await queryAcademic<EntryRow[]>(
    `
    SELECT
      e.*,
      sl.display_name AS faculty_name,
      sl.hrms_employee_id AS faculty_hrms_id
    FROM ap_timetable_entries e
    LEFT JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
    WHERE e.plan_id = ?
    `,
    [planId],
  );
  return rows;
}

type TimingSlotRow = Awaited<ReturnType<typeof listTimingSlots>>[number];

type PlanScope = {
  academic_year_label: string;
  college_id: number;
  course_id: number;
  branch_id: number;
  batch: string;
  semester_number: number | null;
  section_name: string | null;
};

function planScopeFromRow(plan: PlanRow): PlanScope {
  return {
    academic_year_label: plan.academic_year_label,
    college_id: plan.college_id,
    course_id: plan.course_id,
    branch_id: plan.branch_id,
    batch: plan.batch,
    semester_number: plan.semester_number,
    section_name: plan.section_name,
  };
}

function planScopeFromDraftInput(input: {
  academicYear: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  batch: string;
  semester: number;
  section?: string | null;
}): PlanScope {
  return {
    academic_year_label: input.academicYear,
    college_id: input.collegeId,
    course_id: input.courseId,
    branch_id: input.branchId,
    batch: input.batch,
    semester_number: input.semester,
    section_name: input.section ?? null,
  };
}

async function findPublishedPlanForScope(scope: PlanScope): Promise<PlanRow | null> {
  const rows = await queryAcademic<PlanRow[]>(
    `
    SELECT *
    FROM ap_timetable_plans
    WHERE academic_year_label = ?
      AND college_id = ?
      AND course_id = ?
      AND branch_id = ?
      AND batch = ?
      AND semester_number = ?
      AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
      AND status = 'published'
    ORDER BY version_no DESC, id DESC
    LIMIT 1
    `,
    [
      scope.academic_year_label,
      scope.college_id,
      scope.course_id,
      scope.branch_id,
      scope.batch,
      scope.semester_number,
      scope.section_name,
      scope.section_name,
    ],
  );
  return rows[0] ?? null;
}

function slotTimingKey(
  slots: TimingSlotRow[],
  slotId: number,
  dayOfWeek: DayCode,
): { start: string; end: string } | null {
  const slot =
    slots.find((item) => item.id === slotId && item.dayOfWeek === dayOfWeek) ??
    slots.find((item) => item.id === slotId);
  return slot ? { start: slot.startTime, end: slot.endTime } : null;
}

function buildEntrySignatureSet(entries: EntryRow[], slots: TimingSlotRow[]): Set<string> {
  const signatures = new Set<string>();
  for (const entry of entries) {
    if (!isAssignedEntry(entry)) continue;
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const timing = slotTimingKey(slots, slotId, entry.day_of_week);
    signatures.add(
      [
        entry.day_of_week,
        timing?.start ?? "",
        timing?.end ?? "",
        entry.subject_id ?? "",
        entry.faculty_staff_link_id ?? "",
        (entry.room_label ?? "").trim(),
        (entry.custom_label ?? "").trim(),
        entry.entry_type ?? "",
      ].join("|"),
    );
  }
  return signatures;
}

function buildAssignmentSignatureSet(
  assignments: Array<AssignmentInput & { facultyStaffLinkId?: number | null }>,
  slots: TimingSlotRow[],
): Set<string> {
  const signatures = new Set<string>();
  for (const assignment of assignments) {
    const day = toDayCode(String(assignment.dayOfWeek));
    const timing = slotTimingKey(slots, assignment.timingSlotId, day);
    const customLabel = (assignment.customLabel ?? "").trim();
    const isSpecial = customLabel.length > 0 && !assignment.subjectId;
    if (!isSpecial && (!assignment.subjectId || !assignment.facultyStaffLinkId)) continue;
    signatures.add(
      [
        day,
        timing?.start ?? "",
        timing?.end ?? "",
        assignment.subjectId ?? "",
        assignment.facultyStaffLinkId ?? "",
        (assignment.roomLabel ?? "").trim(),
        customLabel,
        assignment.entryType ?? "",
      ].join("|"),
    );
  }
  return signatures;
}

function signatureSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const signature of left) {
    if (!right.has(signature)) return false;
  }
  return true;
}

async function getPublishComparisonMeta(plan: PlanRow, entries: EntryRow[]) {
  const publishedPlan = await findPublishedPlanForScope(planScopeFromRow(plan));
  if (!publishedPlan || publishedPlan.id === plan.id || !plan.timing_template_id) {
    return {
      unchanged: false,
      unchangedFromPublishedPlanId: null as number | null,
      unchangedFromPublishedVersion: null as number | null,
      message: null as string | null,
    };
  }

  const slots = await listTimingSlots(plan.timing_template_id);
  const publishedEntries = await loadEntries(publishedPlan.id);
  const unchanged = signatureSetsEqual(
    buildEntrySignatureSet(entries, slots),
    buildEntrySignatureSet(publishedEntries, slots),
  );

  return {
    unchanged,
    unchangedFromPublishedPlanId: unchanged ? publishedPlan.id : null,
    unchangedFromPublishedVersion: unchanged ? publishedPlan.version_no : null,
    message: unchanged
      ? `No changes since published plan #${publishedPlan.id} (version ${publishedPlan.version_no}). The live timetable is already up to date.`
      : null,
  };
}

function buildGrid(
  slots: Awaited<ReturnType<typeof listTimingSlots>>,
  entries: EntryRow[],
) {
  const days = [...new Set(slots.map((s) => s.dayLabel))];
  const slotsByDay: Record<string, typeof slots> = {};
  for (const day of days) slotsByDay[day] = [];
  for (const slot of slots) {
    slotsByDay[slot.dayLabel] = slotsByDay[slot.dayLabel] ?? [];
    slotsByDay[slot.dayLabel].push(slot);
  }

  const entryMap = new Map<string, EntryRow>();
  for (const entry of entries) {
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    entryMap.set(`${entry.day_of_week}:${slotId}`, entry);
  }

  const grid: Record<
    string,
    Record<
      number,
      {
        slotId: number;
        slotType: string;
        assignable: boolean;
        label: string;
        startTime: string;
        endTime: string;
        entry: null | {
          id: number;
          subjectId: number | null;
          subjectCode: string | null;
          subjectName: string | null;
          subjectTypeSnapshot: string | null;
          entryType: string;
          facultyStaffLinkId: number | null;
          facultyName: string | null;
          facultyHrmsId: string | null;
          roomLabel: string | null;
          customLabel: string | null;
        };
      }
    >
  > = {};

  for (const day of days) {
    grid[day] = {};
    for (const slot of slotsByDay[day] ?? []) {
      const dayCode = toDayCode(day);
      const found = entryMap.get(`${dayCode}:${slot.id}`);
      grid[day][slot.id] = {
        slotId: slot.id,
        slotType: slot.slotType,
        assignable: slot.isAssignable,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        entry: found
          ? {
              id: found.id,
              subjectId: found.subject_id,
              subjectCode: found.subject_code,
              subjectName: found.subject_name,
              subjectTypeSnapshot: found.subject_type_snapshot ?? null,
              entryType: found.entry_type,
              facultyStaffLinkId: found.faculty_staff_link_id,
              facultyName: found.faculty_name ?? null,
              facultyHrmsId: found.faculty_hrms_id ?? null,
              roomLabel: found.room_label,
              customLabel: found.custom_label ?? null,
            }
          : null,
      };
    }
  }

  return { days, slotsByDay, grid };
}

export async function getTimetablePlanner(filters: TimetablePlannerFilters = {}) {
  const context = await resolveContext(filters);
  const academicYear = filters.academicYear ?? "";
  const semester = filters.semester;
  const batch = filters.batch;
  const year = filters.year ?? null;

  const sectionLabel =
    filters.section && filters.section !== "all"
      ? filters.section
      : context?.hasSections
        ? null
        : null;

  const requires = {
    college: !filters.collegeId,
    course: !filters.courseId,
    branch: !filters.branchId,
    academicYear: !academicYear,
    semester: !semester,
    batch: !batch,
    section: Boolean(context?.hasSections && !sectionLabel),
  };

  const contextComplete =
    Boolean(context) &&
    Boolean(academicYear) &&
    Boolean(semester) &&
    Boolean(batch) &&
    (!context?.hasSections || Boolean(sectionLabel));

  if (!contextComplete || !context || !semester || !batch || !filters.collegeId) {
    return {
      ready: false,
      missingTiming: false,
      requires,
      context: {
        academicYear: academicYear || "—",
        college: context?.collegeName ?? "—",
        course: context?.courseName ?? "—",
        branch: context?.branchName ?? "—",
        branchId: context?.branchId ?? null,
        batch: batch ?? "—",
        year,
        semester: semester ?? null,
        section: sectionLabel ?? "—",
        hasSections: context?.hasSections ?? false,
        studentCount: 0,
        status: null,
        timingTemplateName: null,
        planId: null,
        versionNo: null,
      },
      timing: null,
      days: [] as string[],
      slotsByDay: {} as Record<string, unknown>,
      grid: {},
      entries: [],
      subjects: [],
      faculty: [],
      review: null,
    };
  }

  const timing = await getActiveTimingForContext({
    collegeId: filters.collegeId,
    academicYear,
    semester,
  });

  if (!timing) {
    return {
      ready: false,
      missingTiming: true,
      requires,
      context: {
        academicYear,
        college: context.collegeName,
        course: context.courseName,
        branch: context.branchName,
        branchId: context.branchId,
        batch,
        year,
        semester,
        section: sectionLabel ?? "—",
        hasSections: context.hasSections,
        studentCount: await countStudentsForScope(filters),
        status: null,
        timingTemplateName: null,
        planId: null,
        versionNo: null,
      },
      timing: null,
      days: [],
      slotsByDay: {},
      grid: {},
      entries: [],
      subjects: await listSubjectsForPlanner(filters),
      faculty: await listFacultyOptions(),
      review: null,
      message:
        "No academic timing configuration found. Please configure the timing schedule for this college, academic year and semester before creating the timetable.",
    };
  }

  const plan = await findPlan({
    collegeId: context.collegeId,
    courseId: context.courseId,
    branchId: context.branchId,
    academicYear,
    batch,
    semester,
    section: sectionLabel,
    year,
  });

  const entriesRaw = plan ? await loadEntries(plan.id) : [];
  const entries = await hydrateEntriesForDisplay(entriesRaw, plan?.status);
  const { days, slotsByDay, grid } = buildGrid(timing.slots, entries);
  const [studentCount, subjects, faculty] = await Promise.all([
    countStudentsForScope(filters),
    listSubjectsForPlanner(filters),
    listFacultyOptions(),
  ]);

  return {
    ready: true,
    missingTiming: false,
    requires,
    context: {
      academicYear,
      college: context.collegeName,
      collegeId: context.collegeId,
      course: context.courseName,
      courseId: context.courseId,
      branch: context.branchName,
      branchId: context.branchId,
      batch,
      year,
      semester,
      section: sectionLabel ?? "—",
      hasSections: context.hasSections,
      studentCount,
      status: plan?.status ?? "draft",
      timingTemplateName: timing.name,
      timingTemplateId: timing.id,
      planId: plan?.id ?? null,
      versionNo: plan?.version_no ?? null,
    },
    timing: {
      id: timing.id,
      name: timing.name,
      academicYear: timing.academicYear,
      semester: timing.semester,
      status: timing.status,
    },
    days,
    slotsByDay,
    grid,
    entries: entries.map((e) => ({
      id: e.id,
      dayOfWeek: e.day_of_week,
      timingSlotId: e.timing_slot_id ?? e.period_slot_id,
      subjectId: e.subject_id,
      subjectCode: e.subject_code,
      subjectName: e.subject_name,
      subjectTypeSnapshot: e.subject_type_snapshot ?? null,
      entryType: e.entry_type,
      facultyStaffLinkId: e.faculty_staff_link_id,
      facultyName: e.faculty_name,
      roomLabel: e.room_label,
      customLabel: e.custom_label ?? null,
    })),
    subjects,
    faculty,
    review: null,
  };
}

async function resolveFacultyLink(
  assignment: AssignmentInput,
  context?: {
    collegeId?: number | null;
    branchId?: number | null;
    actorUserId?: number | null;
    ipAddress?: string | null;
  },
) {
  if (!assignment.hrmsEmployeeId && !assignment.facultyStaffLinkId) return null;

  if (context?.collegeId) {
    try {
      const result = await ensureStaffUserForSubjectAssignment({
        hrmsEmployeeId: assignment.hrmsEmployeeId ?? null,
        facultyStaffLinkId: assignment.facultyStaffLinkId ?? null,
        displayName: assignment.facultyName ?? null,
        collegeId: context.collegeId,
        branchId: context.branchId ?? null,
        actorUserId: context.actorUserId ?? null,
        ipAddress: context.ipAddress ?? null,
      });
      if (result) return result.staffLinkId;
    } catch (err) {
      console.warn("Could not ensure staff user profile on resolveFacultyLink", err);
    }
  }

  if (assignment.facultyStaffLinkId) return assignment.facultyStaffLinkId;
  if (!assignment.hrmsEmployeeId) return null;
  return ensureStaffLink({
    hrmsEmployeeId: assignment.hrmsEmployeeId,
    displayName: assignment.facultyName ?? null,
  });
}

export async function validatePlanAssignments(
  plan: PlanRow,
  entries: EntryRow[],
  options?: { requireComplete?: boolean },
) {
  const requireComplete = options?.requireComplete ?? false;
  const warnings: string[] = [];
  const sectionClashes: string[] = [];
  const facultyClashes: string[] = [];
  const unassigned: string[] = [];

  if (!plan.timing_template_id) {
    return {
      ok: false,
      assignedCount: 0,
      unassignedSlots: unassigned,
      sectionClashes: ["Plan has no timing template"],
      facultyClashes,
      roomClashes: [] as string[],
      warnings,
    };
  }

  const slots = await listTimingSlots(plan.timing_template_id);
  const classSlots = slots.filter((s) => s.isAssignable);
  const entryByKey = new Map<string, EntryRow>();
  for (const entry of entries) {
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const key = `${entry.day_of_week}:${slotId}`;
    if (entryByKey.has(key)) {
      sectionClashes.push(
        `Section clash on ${DAY_CODE_TO_LABEL[entry.day_of_week]} slot ${slotId}`,
      );
    }
    entryByKey.set(key, entry);
  }

  for (const slot of classSlots) {
    const key = `${slot.dayOfWeek}:${slot.id}`;
    const entry = entryByKey.get(key);
    if (!entry || !isAssignedEntry(entry)) {
      unassigned.push(`${slot.dayLabel} ${slot.label} (${slot.startTime}-${slot.endTime})`);
    }
  }

  // Faculty clashes across published/in_review/draft plans sharing same college timing window
  const facultyKeys = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.faculty_staff_link_id) continue;
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) continue;
    const localKey = `${entry.faculty_staff_link_id}:${entry.day_of_week}:${slot.startTime}:${slot.endTime}`;
    facultyKeys.set(localKey, `${DAY_CODE_TO_LABEL[entry.day_of_week]} ${slot.label}`);
  }

  if (entries.some((e) => e.faculty_staff_link_id)) {
    const facultyIds = [
      ...new Set(
        entries
          .map((e) => e.faculty_staff_link_id)
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    if (facultyIds.length) {
      const otherEntries = await queryAcademic<
        (EntryRow & {
          other_plan_id: number;
          other_section: string | null;
          other_branch: number;
          tpl_id: number;
          slot_start: string;
          slot_end: string;
          slot_day: DayCode;
        })[]
      >(
        `
        SELECT
          e.*,
          p.id AS other_plan_id,
          p.section_name AS other_section,
          p.branch_id AS other_branch,
          p.timing_template_id AS tpl_id,
          s.start_time AS slot_start,
          s.end_time AS slot_end,
          s.day_of_week AS slot_day
        FROM ap_timetable_entries e
        INNER JOIN ap_timetable_plans p ON p.id = e.plan_id
        INNER JOIN ap_timing_template_slots s
          ON s.id = COALESCE(e.timing_slot_id, e.period_slot_id)
        WHERE e.faculty_staff_link_id IN (${facultyIds.map(() => "?").join(",")})
          AND p.id <> ?
          AND p.college_id = ?
          AND p.status IN ('draft','in_review','published')
          AND NOT (
            p.status = 'published'
            AND p.academic_year_label = ?
            AND p.college_id = ?
            AND p.course_id = ?
            AND p.branch_id = ?
            AND p.batch = ?
            AND p.semester_number = ?
            AND ((? IS NULL AND (p.section_name IS NULL OR p.section_name = '')) OR p.section_name = ?)
          )
        `,
        [
          ...facultyIds,
          plan.id,
          plan.college_id,
          plan.academic_year_label,
          plan.college_id,
          plan.course_id,
          plan.branch_id,
          plan.batch,
          plan.semester_number,
          plan.section_name,
          plan.section_name,
        ],
      );

      const clashMessages = new Set<string>();
      for (const other of otherEntries) {
        const key = `${other.faculty_staff_link_id}:${other.slot_day}:${String(other.slot_start).slice(0, 5)}:${String(other.slot_end).slice(0, 5)}`;
        if (facultyKeys.has(key)) {
          clashMessages.add(
            `Faculty clash: same staff on ${DAY_CODE_TO_LABEL[other.slot_day]} ${String(other.slot_start).slice(0, 5)}-${String(other.slot_end).slice(0, 5)} (also in plan #${other.other_plan_id}${other.other_section ? ` · ${other.other_section}` : ""})`,
          );
        }
      }
      facultyClashes.push(...clashMessages);
    }
  }

  for (const entry of entries) {
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) {
      warnings.push(`Entry #${entry.id} references invalid timing slot`);
      continue;
    }
    if (!slot.isAssignable && entry.subject_id) {
      warnings.push(`Assignment on non-class slot ${slot.label}`);
    }
  }

  const publishComparison = await getPublishComparisonMeta(plan, entries);
  if (publishComparison.message) {
    warnings.push(publishComparison.message);
  }

  const ok =
    sectionClashes.length === 0 &&
    facultyClashes.length === 0 &&
    (!requireComplete || unassigned.length === 0);

  return {
    ok,
    assignedCount: entries.filter((e) => isAssignedEntry(e)).length,
    unassignedSlots: unassigned,
    sectionClashes,
    facultyClashes,
    roomClashes: [] as string[],
    warnings,
    unchanged: publishComparison.unchanged,
    unchangedFromPublishedPlanId: publishComparison.unchangedFromPublishedPlanId,
    unchangedFromPublishedVersion: publishComparison.unchangedFromPublishedVersion,
    message: publishComparison.message,
  };
}

async function writeVersion(
  conn: PoolConnection,
  planId: number,
  action: string,
  snapshot: unknown,
  reason?: string,
) {
  await conn.execute(
    `
    INSERT INTO ap_timetable_versions (plan_id, action, reason, snapshot_json)
    VALUES (?, ?, ?, ?)
    `,
    [planId, action, reason ?? null, JSON.stringify(snapshot)],
  );
}

export async function saveTimetableDraft(input: {
  collegeId: number;
  courseId: number;
  branchId: number;
  academicYear: string;
  batch: string;
  year?: number | null;
  semester: number;
  section?: string | null;
  notes?: string | null;
  assignments: AssignmentInput[];
  actorUserId?: number | null;
  ipAddress?: string | null;
}) {
  const timing = await getActiveTimingForContext({
    collegeId: input.collegeId,
    academicYear: input.academicYear,
    semester: input.semester,
  });
  if (!timing) {
    throw new Error(
      "No academic timing configuration found for this college, academic year and semester.",
    );
  }

  const slotIds = new Set(timing.slots.map((s) => s.id));
  const classSlotIds = new Set(
    timing.slots.filter((s) => s.isAssignable).map((s) => s.id),
  );

  for (const a of input.assignments) {
    if (!slotIds.has(a.timingSlotId)) {
      throw new Error(`Timing slot ${a.timingSlotId} does not belong to active template`);
    }
    if (!classSlotIds.has(a.timingSlotId)) {
      throw new Error(`Cannot assign class on non-CLASS slot ${a.timingSlotId}`);
    }
    if (isFreePeriodAssignment(a)) {
      continue;
    }
    if (!a.subjectId || (!a.facultyStaffLinkId && !a.hrmsEmployeeId)) {
      throw new Error(
        "Subject and Faculty are required for class periods (or enter a free/special label like CRT / Games)",
      );
    }
  }

  // Section clash within payload
  const seen = new Set<string>();
  for (const a of input.assignments) {
    const day = toDayCode(String(a.dayOfWeek));
    const key = `${day}:${a.timingSlotId}`;
    if (seen.has(key)) throw new Error(`Section clash on ${key}`);
    seen.add(key);
  }

  // Verify subjects against EMS — do not trust client code/name/type
  const verifiedAssignments = await resolveAssignmentSubjectsFromEms(
    input.assignments,
  );

  const facultyContext = {
    collegeId: input.collegeId,
    branchId: input.branchId,
    actorUserId: input.actorUserId,
    ipAddress: input.ipAddress,
  };

  const publishedPlan = await findPublishedPlanForScope(planScopeFromDraftInput(input));
  const timingSlots = await listTimingSlots(timing.id);
  const resolvedAssignments: Array<AssignmentInput & { facultyStaffLinkId: number | null }> = [];
  for (const assignment of verifiedAssignments) {
    resolvedAssignments.push({
      ...assignment,
      facultyStaffLinkId: await resolveFacultyLink(assignment, facultyContext),
    });
  }

  const existingDraft = await queryAcademic<PlanRow[]>(
    `
    SELECT * FROM ap_timetable_plans
    WHERE academic_year_label = ?
      AND college_id = ?
      AND course_id = ?
      AND branch_id = ?
      AND batch = ?
      AND semester_number = ?
      AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
      AND status IN ('draft','in_review')
    ORDER BY id DESC
    LIMIT 1
    `,
    [
      input.academicYear,
      input.collegeId,
      input.courseId,
      input.branchId,
      input.batch,
      input.semester,
      input.section ?? null,
      input.section ?? null,
    ],
  );

  if (!existingDraft[0] && publishedPlan) {
    const publishedEntries = await loadEntries(publishedPlan.id);
    if (
      signatureSetsEqual(
        buildAssignmentSignatureSet(resolvedAssignments, timingSlots),
        buildEntrySignatureSet(publishedEntries, timingSlots),
      )
    ) {
      return {
        planId: publishedPlan.id,
        status: "published",
        versionNo: publishedPlan.version_no,
        timingTemplateId: timing.id,
        unchanged: true,
      };
    }
  }

  return withAcademicTransaction(async (conn) => {
    const [existingRows] = await conn.query<PlanRow[]>(
      `
      SELECT * FROM ap_timetable_plans
      WHERE academic_year_label = ?
        AND college_id = ?
        AND course_id = ?
        AND branch_id = ?
        AND batch = ?
        AND semester_number = ?
        AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
        AND status IN ('draft','in_review')
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        input.academicYear,
        input.collegeId,
        input.courseId,
        input.branchId,
        input.batch,
        input.semester,
        input.section ?? null,
        input.section ?? null,
      ],
    );

    let planId = existingRows[0]?.id;
    let versionNo = existingRows[0]?.version_no ?? 1;

    if (!planId) {
      const [publishedRows] = await conn.query<PlanRow[]>(
        `
        SELECT version_no FROM ap_timetable_plans
        WHERE academic_year_label = ?
          AND college_id = ?
          AND course_id = ?
          AND branch_id = ?
          AND batch = ?
          AND semester_number = ?
          AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
          AND status = 'published'
        ORDER BY version_no DESC
        LIMIT 1
        `,
        [
          input.academicYear,
          input.collegeId,
          input.courseId,
          input.branchId,
          input.batch,
          input.semester,
          input.section ?? null,
          input.section ?? null,
        ],
      );
      versionNo = (publishedRows[0]?.version_no ?? 0) + 1;

      const [insertResult] = await conn.execute(
        `
        INSERT INTO ap_timetable_plans
          (academic_year_label, college_id, course_id, branch_id, batch, year_of_study,
           semester_number, section_name, timing_template_id, status, version_no, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        `,
        [
          input.academicYear,
          input.collegeId,
          input.courseId,
          input.branchId,
          input.batch,
          input.year ?? null,
          input.semester,
          input.section ?? null,
          timing.id,
          versionNo,
          input.notes ?? null,
        ],
      );
      planId = Number((insertResult as { insertId: number }).insertId);
      await writeVersion(conn, planId, "created", { timingTemplateId: timing.id });
    } else {
      await conn.execute(
        `
        UPDATE ap_timetable_plans
        SET timing_template_id = ?, status = 'draft', notes = ?, year_of_study = ?
        WHERE id = ?
        `,
        [timing.id, input.notes ?? null, input.year ?? null, planId],
      );
      await writeVersion(conn, planId, "edited", {
        assignmentCount: verifiedAssignments.length,
      });
    }

    let previousFacultyIds: number[] = [];
    if (planId) {
      const [prevFacRows] = await conn.query<
        (RowDataPacket & { faculty_staff_link_id: number | null })[]
      >(
        `SELECT DISTINCT faculty_staff_link_id FROM ap_timetable_entries WHERE plan_id = ? AND faculty_staff_link_id IS NOT NULL`,
        [planId],
      );
      previousFacultyIds = prevFacRows
        .map((r) => Number(r.faculty_staff_link_id))
        .filter((id) => id > 0);
    }

    await conn.execute(`DELETE FROM ap_timetable_entries WHERE plan_id = ?`, [planId]);

    const newFacultyIds = new Set<number>();
    for (const a of verifiedAssignments) {
      const day = toDayCode(String(a.dayOfWeek));
      const facultyLinkId = await resolveFacultyLink(a, facultyContext);
      if (facultyLinkId) newFacultyIds.add(facultyLinkId);
      const customLabel = (a.customLabel ?? "").trim() || null;
      await conn.execute(
        `
        INSERT INTO ap_timetable_entries
          (plan_id, day_of_week, period_slot_id, timing_slot_id, subject_id, subject_code,
           subject_name, subject_type_snapshot, entry_type, faculty_staff_link_id, room_label,
           custom_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          planId,
          day,
          a.timingSlotId,
          a.timingSlotId,
          a.subjectId ?? null,
          a.subjectCode ?? null,
          a.subjectName ?? null,
          a.subjectTypeSnapshot ?? null,
          a.entryType ?? "theory",
          facultyLinkId,
          a.roomLabel ?? null,
          customLabel,
        ],
      );
    }

    return {
      planId,
      status: "draft",
      versionNo,
      timingTemplateId: timing.id,
      previousFacultyIds,
      newFacultyIds: [...newFacultyIds],
    };
  }).then(async (result) => {
    // If faculty were removed from this timetable plan, check and sync user roles
    const removedFacultyIds = result.previousFacultyIds.filter(
      (id) => !result.newFacultyIds.includes(id),
    );
    if (removedFacultyIds.length > 0) {
      try {
        await syncStaffUserRolesForTimetableChanges({
          collegeId: input.collegeId,
          branchId: input.branchId,
          candidateStaffLinkIds: removedFacultyIds,
          actorUserId: input.actorUserId,
          ipAddress: input.ipAddress,
        });
      } catch (err) {
        console.warn("Could not sync user roles after timetable draft update", err);
      }
    }
    return {
      planId: result.planId,
      status: result.status,
      versionNo: result.versionNo,
      timingTemplateId: result.timingTemplateId,
    };
  });
}

export async function getTimetablePlanScope(planId: number) {
  const plans = await queryAcademic<PlanRow[]>(
    `SELECT id, college_id, branch_id FROM ap_timetable_plans WHERE id = ? LIMIT 1`,
    [planId],
  );
  const plan = plans[0];
  if (!plan) return null;
  return {
    collegeId: Number(plan.college_id),
    branchId: Number(plan.branch_id),
  };
}

export async function reviewTimetablePlan(planId: number) {
  const plans = await queryAcademic<PlanRow[]>(
    `SELECT * FROM ap_timetable_plans WHERE id = ? LIMIT 1`,
    [planId],
  );
  const plan = plans[0];
  if (!plan) throw new Error("Plan not found");
  if (!["draft", "in_review"].includes(plan.status)) {
    throw new Error(`Cannot review plan in status ${plan.status}`);
  }

  const entries = await loadEntries(planId);
  const review = await validatePlanAssignments(plan, entries, {
    requireComplete: false,
  });

  await executeAcademic(
    `UPDATE ap_timetable_plans SET status = 'in_review' WHERE id = ?`,
    [planId],
  );
  await executeAcademic(
    `
    INSERT INTO ap_timetable_versions (plan_id, action, reason, snapshot_json)
    VALUES (?, 'submitted', ?, ?)
    `,
    [planId, "Moved to review", JSON.stringify(review)],
  );

  return { planId, status: "in_review", review };
}

export async function publishTimetablePlan(
  planId: number,
  options?: { actorUserId?: number | null; ipAddress?: string | null },
) {
  const plans = await queryAcademic<PlanRow[]>(
    `SELECT * FROM ap_timetable_plans WHERE id = ? LIMIT 1`,
    [planId],
  );
  const plan = plans[0];
  if (!plan) throw new Error("Plan not found");
  if (!["draft", "in_review"].includes(plan.status)) {
    throw new Error(`Cannot publish plan in status ${plan.status}`);
  }

  // Freeze current EMS subject labels into entry snapshots before publish
  const snapshotRefresh = await refreshEntrySubjectSnapshots(planId);

  const entries = await loadEntries(planId);
  const review = await validatePlanAssignments(plan, entries, {
    requireComplete: true,
  });
  if (review.unchanged) {
    const err = new Error(
      review.message ?? "This timetable is already published with no changes.",
    );
    (err as Error & { review?: unknown }).review = review;
    throw err;
  }
  if (!review.ok) {
    const err = new Error("Publish blocked: timetable has validation errors");
    (err as Error & { review?: unknown }).review = review;
    throw err;
  }

  // Ensure all faculty assigned in the timetable have active user profiles with 'staff' role
  for (const entry of entries) {
    if (entry.faculty_staff_link_id) {
      try {
        await ensureStaffUserForSubjectAssignment({
          facultyStaffLinkId: entry.faculty_staff_link_id,
          collegeId: plan.college_id,
          branchId: plan.branch_id,
          actorUserId: options?.actorUserId,
          ipAddress: options?.ipAddress,
        });
      } catch (err) {
        console.warn("Could not ensure staff user profile on publish for entry faculty", entry.faculty_staff_link_id, err);
      }
    }
  }

  return withAcademicTransaction(async (conn) => {
    // Find faculty in existing published plans that will be superseded
    const [supersededFacultyRows] = await conn.query<
      (RowDataPacket & { faculty_staff_link_id: number | null })[]
    >(
      `
      SELECT DISTINCT e.faculty_staff_link_id
      FROM ap_timetable_entries e
      INNER JOIN ap_timetable_plans p ON p.id = e.plan_id
      WHERE p.academic_year_label = ?
        AND p.college_id = ?
        AND p.course_id = ?
        AND p.branch_id = ?
        AND p.batch = ?
        AND p.semester_number = ?
        AND ((? IS NULL AND (p.section_name IS NULL OR p.section_name = '')) OR p.section_name = ?)
        AND p.status = 'published'
        AND p.id <> ?
        AND e.faculty_staff_link_id IS NOT NULL
      `,
      [
        plan.academic_year_label,
        plan.college_id,
        plan.course_id,
        plan.branch_id,
        plan.batch,
        plan.semester_number,
        plan.section_name,
        plan.section_name,
        planId,
      ],
    );
    const candidateFacultyIds = supersededFacultyRows
      .map((r) => Number(r.faculty_staff_link_id))
      .filter((id) => id > 0);

    await conn.execute(
      `
      UPDATE ap_timetable_plans
      SET status = 'superseded'
      WHERE academic_year_label = ?
        AND college_id = ?
        AND course_id = ?
        AND branch_id = ?
        AND batch = ?
        AND semester_number = ?
        AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
        AND status = 'published'
        AND id <> ?
      `,
      [
        plan.academic_year_label,
        plan.college_id,
        plan.course_id,
        plan.branch_id,
        plan.batch,
        plan.semester_number,
        plan.section_name,
        plan.section_name,
        planId,
      ],
    );

    // Cancel unposted scheduled sessions from superseded plans so they don't produce duplicate slots
    await conn.execute(
      `
      UPDATE ap_class_sessions cs
      INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
      SET cs.status = 'cancelled'
      WHERE p.status = 'superseded'
        AND cs.status = 'scheduled'
        AND NOT EXISTS (
          SELECT 1 FROM ap_attendance_posts ap WHERE ap.class_session_id = cs.id
        )
      `,
    );

    await conn.execute(
      `
      UPDATE ap_timetable_plans
      SET status = 'published', published_at = NOW()
      WHERE id = ?
      `,
      [planId],
    );

    await writeVersion(
      conn,
      planId,
      "published",
      { review, subjectSnapshotsRefreshed: snapshotRefresh.refreshed },
      "Published",
    );

    // Mark superseded versions history on previous plans
    const [prev] = await conn.query<PlanRow[]>(
      `
      SELECT id FROM ap_timetable_plans
      WHERE status = 'superseded'
        AND academic_year_label = ?
        AND college_id = ?
        AND course_id = ?
        AND branch_id = ?
        AND batch = ?
        AND semester_number = ?
        AND ((? IS NULL AND (section_name IS NULL OR section_name = '')) OR section_name = ?)
      `,
      [
        plan.academic_year_label,
        plan.college_id,
        plan.course_id,
        plan.branch_id,
        plan.batch,
        plan.semester_number,
        plan.section_name,
        plan.section_name,
      ],
    );
    for (const row of prev) {
      await writeVersion(conn, row.id, "superseded", { byPlanId: planId });
    }

    return {
      planId,
      status: "published",
      versionNo: plan.version_no,
      review,
      subjectSnapshotsRefreshed: snapshotRefresh.refreshed,
      candidateFacultyIds,
    };
  }).then(async (result) => {
    // If faculty were teaching in the superseded plans, check if they have any remaining active teaching assignments
    if (result.candidateFacultyIds?.length) {
      try {
        await syncStaffUserRolesForTimetableChanges({
          collegeId: plan.college_id,
          branchId: plan.branch_id,
          candidateStaffLinkIds: result.candidateFacultyIds,
          actorUserId: options?.actorUserId,
          ipAddress: options?.ipAddress,
        });
      } catch (err) {
        console.warn("Could not sync user roles after timetable publish", err);
      }
    }
    return {
      planId: result.planId,
      status: result.status,
      versionNo: result.versionNo,
      review: result.review,
      subjectSnapshotsRefreshed: result.subjectSnapshotsRefreshed,
    };
  });
}

export async function getTimetableVersions(planId: number) {
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      plan_id: number;
      action: string;
      reason: string | null;
      created_at: string;
    })[]
  >(
    `
    SELECT id, plan_id, action, reason, created_at
    FROM ap_timetable_versions
    WHERE plan_id = ?
    ORDER BY id DESC
    `,
    [planId],
  );
  return rows;
}

export async function copyTimetablePlan(input: {
  sourcePlanId: number;
  target: {
    collegeId: number;
    courseId: number;
    branchId: number;
    academicYear: string;
    batch: string;
    year?: number | null;
    semester: number;
    section?: string | null;
  };
  actorUserId?: number | null;
  ipAddress?: string | null;
}) {
  const sourcePlans = await queryAcademic<PlanRow[]>(
    `SELECT * FROM ap_timetable_plans WHERE id = ? LIMIT 1`,
    [input.sourcePlanId],
  );
  const source = sourcePlans[0];
  if (!source) throw new Error("Source plan not found");

  const targetTiming = await getActiveTimingForContext({
    collegeId: input.target.collegeId,
    academicYear: input.target.academicYear,
    semester: input.target.semester,
  });
  if (!targetTiming) {
    throw new Error("Target college has no active timing template for year/semester");
  }

  const sourceEntries = await loadEntries(source.id);
  const sourceSlots = source.timing_template_id
    ? await listTimingSlots(source.timing_template_id)
    : [];

  // Map by day + label + start/end when possible
  const assignments: AssignmentInput[] = [];
  for (const entry of sourceEntries) {
    const srcSlotId = entry.timing_slot_id ?? entry.period_slot_id;
    const srcSlot = sourceSlots.find((s) => s.id === srcSlotId);
    if (!srcSlot || !srcSlot.isAssignable) continue;
    const targetSlot = targetTiming.slots.find(
      (s) =>
        s.dayOfWeek === srcSlot.dayOfWeek &&
        s.label === srcSlot.label &&
        s.startTime === srcSlot.startTime &&
        s.endTime === srcSlot.endTime &&
        s.isAssignable,
    );
    if (!targetSlot) continue;
    assignments.push({
      dayOfWeek: entry.day_of_week,
      timingSlotId: targetSlot.id,
      subjectId: entry.subject_id,
      subjectCode: entry.subject_code,
      subjectName: entry.subject_name,
      entryType: (entry.entry_type as "theory" | "lab" | "other") || "theory",
      facultyStaffLinkId: entry.faculty_staff_link_id,
      roomLabel: entry.room_label,
      customLabel: entry.custom_label,
    });
  }

  return saveTimetableDraft({
    ...input.target,
    notes: `Copied from plan #${source.id}`,
    assignments,
    actorUserId: input.actorUserId,
    ipAddress: input.ipAddress,
  });
}

export async function getTimetableCoverage(filters: TimetablePlannerFilters = {}) {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filters.collegeId) {
    where.push("college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.branchId) {
    where.push("branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.section && filters.section !== "all") {
    where.push("section_name = ?");
    params.push(filters.section);
  }

  try {
    const rows = await queryAcademic<
      (RowDataPacket & { total: number; published: number })[]
    >(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
      FROM ap_timetable_plans
      WHERE ${where.join(" AND ")}
      `,
      params,
    );
    return {
      sectionCount: 0,
      published: Number(rows[0]?.published ?? 0),
      totalPlans: Number(rows[0]?.total ?? 0),
      pendingSections: 0,
    };
  } catch {
    return { sectionCount: 0, published: 0, totalPlans: 0, pendingSections: 0 };
  }
}

// Kept for route compatibility; sections remain student-master data only.
export async function listTimetableSections(filters: TimetablePlannerFilters = {}) {
  const where: string[] = ["TRIM(IFNULL(ss.section_name, '')) <> ''"];
  const params: unknown[] = [];
  if (filters.branchId) {
    where.push("ss.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`ss.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.section && filters.section !== "all") {
    where.push("TRIM(ss.section_name) = ?");
    params.push(filters.section);
  }
  if (filters.batch) {
    where.push("ss.batch = ?");
    params.push(filters.batch);
  }
  const rows = await queryStudent<
    (RowDataPacket & {
      branch_id: number;
      batch: string;
      section_name: string;
      branch_name: string | null;
      student_count: number;
    })[]
  >(
    `
    SELECT ss.branch_id, ss.batch, TRIM(ss.section_name) AS section_name,
           cb.name AS branch_name, COUNT(*) AS student_count
    FROM student_sections ss
    LEFT JOIN course_branches cb ON cb.id = ss.branch_id
    WHERE ${where.join(" AND ")}
    GROUP BY ss.branch_id, ss.batch, TRIM(ss.section_name), cb.name
    ORDER BY cb.name, ss.batch, TRIM(ss.section_name)
    LIMIT 200
    `,
    params,
  );
  return rows.map((row) => ({
    branchId: row.branch_id,
    batch: row.batch,
    section: row.section_name,
    branchName: row.branch_name ?? `Branch ${row.branch_id}`,
    studentCount: Number(row.student_count),
  }));
}

export async function getTimingTemplateForFilters(filters: TimetablePlannerFilters) {
  if (!filters.collegeId || !filters.academicYear || !filters.semester) {
    return null;
  }
  return getActiveTimingForContext({
    collegeId: filters.collegeId,
    academicYear: filters.academicYear,
    semester: filters.semester,
  });
}

export { getTimingTemplateDetail };
