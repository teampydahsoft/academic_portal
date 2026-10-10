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
import { ensureSessionsForDate } from "./class-sessions.service.js";
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
  batch_label?: string | null;
  student_ids?: number[] | string | null;
  student_count?: number | null;
  weekly_rotation?: number | boolean | null;
  rotation_pattern?: string | null;
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
  /** Classification or batch tag (e.g. Batch 1, Batch 2) */
  batchLabel?: string | null;
  /** Array of student IDs assigned to this batch */
  studentIds?: number[] | null;
  /** Total count of students assigned to this batch */
  studentCount?: number | null;
  /** Whether this split slot rotates batches weekly (Batch 1 <-> Batch 2 alternate weeks) */
  weeklyRotation?: boolean | number | null;
  /** 4-week monthly rotation pattern: e.g. "1,2,1,2" (W1, W2, W3, W4) */
  rotationPattern?: string | null;
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
        (entry.batch_label ?? "").trim(),
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
        (assignment.batchLabel ?? "").trim(),
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

  const entriesMap = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const key = `${entry.day_of_week}:${slotId}`;
    const list = entriesMap.get(key) ?? [];
    list.push(entry);
    entriesMap.set(key, list);
  }

  type GridCellEntry = {
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
    batchLabel: string | null;
    studentIds: number[] | null;
    studentCount: number | null;
    weeklyRotation?: boolean;
    rotationPattern?: string | null;
    customLabel: string | null;
  };

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
        entry: null | GridCellEntry;
        entries: GridCellEntry[];
      }
    >
  > = {};

  for (const day of days) {
    grid[day] = {};
    for (const slot of slotsByDay[day] ?? []) {
      const dayCode = toDayCode(day);
      const foundList = entriesMap.get(`${dayCode}:${slot.id}`) ?? [];
      const mappedEntries: GridCellEntry[] = foundList.map((found) => {
        let parsedStudentIds: number[] | null = null;
        if (Array.isArray(found.student_ids)) {
          parsedStudentIds = found.student_ids as number[];
        } else if (typeof found.student_ids === "string" && found.student_ids.trim()) {
          try {
            parsedStudentIds = JSON.parse(found.student_ids);
          } catch {
            parsedStudentIds = null;
          }
        }
        return {
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
          batchLabel: found.batch_label ?? null,
          studentIds: parsedStudentIds,
          studentCount: found.student_count ?? (parsedStudentIds ? parsedStudentIds.length : null),
          weeklyRotation: Boolean(found.weekly_rotation),
          rotationPattern: found.rotation_pattern ?? null,
          customLabel: found.custom_label ?? null,
        };
      });

      grid[day][slot.id] = {
        slotId: slot.id,
        slotType: slot.slotType,
        assignable: slot.isAssignable,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        entry: mappedEntries[0] ?? null,
        entries: mappedEntries,
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
      batchLabel: e.batch_label ?? null,
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
  const entriesBySlot = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const key = `${entry.day_of_week}:${slotId}`;
    const list = entriesBySlot.get(key) ?? [];
    list.push(entry);
    entriesBySlot.set(key, list);
  }

  for (const [key, slotEntries] of entriesBySlot.entries()) {
    if (slotEntries.length > 1) {
      const seenBatches = new Set<string>();
      const seenFaculty = new Set<number>();
      for (const entry of slotEntries) {
        if (entry.faculty_staff_link_id) {
          if (seenFaculty.has(entry.faculty_staff_link_id)) {
            const [day, slotId] = key.split(":");
            facultyClashes.push(
              `Faculty clash: same faculty assigned multiple times on ${DAY_CODE_TO_LABEL[day as DayCode] ?? day} slot ${slotId}`,
            );
          }
          seenFaculty.add(entry.faculty_staff_link_id);
        }
        const batch = (entry.batch_label ?? "").trim().toLowerCase();
        if (batch) {
          if (seenBatches.has(batch)) {
            const [day, slotId] = key.split(":");
            sectionClashes.push(
              `Duplicate batch classification "${entry.batch_label}" on ${DAY_CODE_TO_LABEL[day as DayCode] ?? day} slot ${slotId}`,
            );
          }
          seenBatches.add(batch);
        }
      }
    }
  }

  for (const slot of classSlots) {
    const key = `${slot.dayOfWeek}:${slot.id}`;
    const slotEntries = entriesBySlot.get(key) ?? [];
    const hasAssigned = slotEntries.some((e) => isAssignedEntry(e));
    if (!hasAssigned) {
      unassigned.push(`${slot.dayLabel} ${slot.label} (${slot.startTime}-${slot.endTime})`);
    }
  }

  // Helper to parse HH:MM into minutes for overlap comparison
  const parseTimeToMinutes = (t: string | null | undefined): number => {
    if (!t) return 0;
    const parts = String(t).slice(0, 5).split(":");
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  };

  // Faculty clashes across published plans sharing same college timing window
  const localFacultyAssignments: Array<{
    facultyLinkId: number;
    dayOfWeek: DayCode;
    startMin: number;
    endMin: number;
    label: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.faculty_staff_link_id) continue;
    const slotId = entry.timing_slot_id ?? entry.period_slot_id;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) continue;
    localFacultyAssignments.push({
      facultyLinkId: entry.faculty_staff_link_id,
      dayOfWeek: entry.day_of_week,
      startMin: parseTimeToMinutes(slot.startTime),
      endMin: parseTimeToMinutes(slot.endTime),
      label: `${DAY_CODE_TO_LABEL[entry.day_of_week]} ${slot.label}`,
    });
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
          AND p.status = 'published'
          AND NOT (
            p.academic_year_label = ?
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
        const otherStartMin = parseTimeToMinutes(other.slot_start);
        const otherEndMin = parseTimeToMinutes(other.slot_end);
        for (const local of localFacultyAssignments) {
          if (
            local.facultyLinkId === other.faculty_staff_link_id &&
            local.dayOfWeek === other.slot_day &&
            otherStartMin < local.endMin &&
            local.startMin < otherEndMin
          ) {
            const isCrossSectionParallel =
              (other.other_section != null &&
                plan.section_name != null &&
                other.other_section.trim().toLowerCase() !== plan.section_name.trim().toLowerCase()) ||
              Boolean(plan.notes?.includes("Combined"));
            const msg = `same staff on ${DAY_CODE_TO_LABEL[other.slot_day]} ${String(other.slot_start).slice(0, 5)}-${String(other.slot_end).slice(0, 5)} (parallel in plan #${other.other_plan_id}${other.other_section ? ` · Section ${other.other_section}` : ""})`;
            if (isCrossSectionParallel) {
              warnings.push(`Combined/Parallel class: ${msg}`);
            } else {
              clashMessages.add(`Faculty clash: ${msg}`);
            }
          }
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

  // Validate within payload: parallel assignments in same slot are allowed,
  // but prevent duplicate faculty or duplicate batch classification in same slot.
  const slotMap = new Map<string, AssignmentInput[]>();
  for (const a of input.assignments) {
    const day = toDayCode(String(a.dayOfWeek));
    const key = `${day}:${a.timingSlotId}`;
    const list = slotMap.get(key) ?? [];
    list.push(a);
    slotMap.set(key, list);
  }

  for (const [key, list] of slotMap.entries()) {
    if (list.length > 1) {
      const seenStaff = new Set<string>();
      const seenBatches = new Set<string>();
      for (const a of list) {
        const staffKey = a.hrmsEmployeeId || (a.facultyStaffLinkId ? String(a.facultyStaffLinkId) : "");
        if (staffKey) {
          if (seenStaff.has(staffKey)) {
            const [day, slotId] = key.split(":");
            throw new Error(
              `Faculty clash: same faculty assigned multiple times in the same slot on ${DAY_CODE_TO_LABEL[day as DayCode] ?? day} (slot ${slotId})`,
            );
          }
          seenStaff.add(staffKey);
        }
        const batch = (a.batchLabel ?? "").trim().toLowerCase();
        if (batch) {
          if (seenBatches.has(batch)) {
            const [day, slotId] = key.split(":");
            throw new Error(
              `Duplicate batch classification "${a.batchLabel}" in the same slot on ${DAY_CODE_TO_LABEL[day as DayCode] ?? day} (slot ${slotId})`,
            );
          }
          seenBatches.add(batch);
        }
      }
    }
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
      const batchLabel = (a.batchLabel ?? "").trim() || null;
      const studentIdsJson =
        Array.isArray(a.studentIds) && a.studentIds.length > 0
          ? JSON.stringify(a.studentIds)
          : null;
      const studentCount =
        typeof a.studentCount === "number"
          ? a.studentCount
          : Array.isArray(a.studentIds) && a.studentIds.length > 0
            ? a.studentIds.length
            : null;
      const weeklyRotation = a.weeklyRotation ? 1 : 0;
      const rotationPattern = (a.rotationPattern ?? "").trim() || null;

      await conn.execute(
        `
        INSERT INTO ap_timetable_entries
          (plan_id, day_of_week, period_slot_id, timing_slot_id, subject_id, subject_code,
           subject_name, subject_type_snapshot, entry_type, faculty_staff_link_id, room_label,
           batch_label, student_ids, student_count, weekly_rotation, rotation_pattern, custom_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          batchLabel,
          studentIdsJson,
          studentCount,
          weeklyRotation,
          rotationPattern,
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
    // Immediately generate and sync class sessions for today so staff see the published classes right away
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      await ensureSessionsForDate(todayIso, { publishedTimetablePlanId: result.planId });
    } catch (err) {
      console.warn("Could not generate class sessions after timetable publish", err);
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
      batchLabel: entry.batch_label ?? "",
      weeklyRotation: Boolean(entry.weekly_rotation),
      rotationPattern: entry.rotation_pattern ?? null,
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

export type CombineSectionsInput = {
  collegeId: number;
  courseId: number;
  branchId: number;
  academicYear: string;
  batch: string;
  year?: number | null;
  semester: number;
  mainSection: string;
  targetSections: string[];
  publish?: boolean;
  actorUserId?: number | null;
  ipAddress?: string | null;
};

export async function combineTimetableSections(input: CombineSectionsInput) {
  const mainSection = input.mainSection?.trim();
  if (!mainSection) {
    throw new Error("Main (source) section is required.");
  }

  const targetSections = (input.targetSections ?? [])
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== mainSection.toLowerCase());

  if (targetSections.length === 0) {
    throw new Error(`Please select at least one target section to combine with Section ${mainSection}.`);
  }

  // 1. Find the current active plan for mainSection
  const sourcePlans = await queryAcademic<PlanRow[]>(
    `
    SELECT * FROM ap_timetable_plans
    WHERE academic_year_label = ?
      AND college_id = ?
      AND course_id = ?
      AND branch_id = ?
      AND batch = ?
      AND semester_number = ?
      AND section_name = ?
      AND status IN ('published', 'in_review', 'draft')
    ORDER BY CASE status WHEN 'published' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END, id DESC
    LIMIT 1
    `,
    [
      input.academicYear,
      input.collegeId,
      input.courseId,
      input.branchId,
      input.batch,
      input.semester,
      mainSection,
    ],
  );

  const sourcePlan = sourcePlans[0];
  if (!sourcePlan) {
    throw new Error(`No timetable plan found for main Section ${mainSection}. Please create and save periods for Section ${mainSection} first.`);
  }

  // 2. Load entries from sourcePlan
  const sourceEntries = await loadEntries(sourcePlan.id);
  if (sourceEntries.length === 0) {
    throw new Error(`Main Section ${mainSection} timetable has no periods assigned yet.`);
  }

  const sourceSlots = sourcePlan.timing_template_id
    ? await listTimingSlots(sourcePlan.timing_template_id)
    : [];

  const targetTiming = await getActiveTimingForContext({
    collegeId: input.collegeId,
    academicYear: input.academicYear,
    semester: input.semester,
  });
  if (!targetTiming) {
    throw new Error("Active timing template not found for year/semester.");
  }

  // Map entries into assignments
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
      batchLabel: entry.batch_label ?? "",
      weeklyRotation: Boolean(entry.weekly_rotation),
      rotationPattern: entry.rotation_pattern ?? null,
    });
  }

  if (assignments.length === 0) {
    throw new Error("Could not map any period slots from the main section to the target timing template.");
  }

  const results: Array<{
    section: string;
    planId: number;
    status: string;
    versionNo: number;
    copiedAssignmentsCount: number;
  }> = [];

  const shouldPublish = input.publish ?? (sourcePlan.status === "published");

  for (const targetSection of targetSections) {
    const draftResult = await saveTimetableDraft({
      collegeId: input.collegeId,
      courseId: input.courseId,
      branchId: input.branchId,
      academicYear: input.academicYear,
      batch: input.batch,
      year: input.year ?? null,
      semester: input.semester,
      section: targetSection,
      notes: `Combined from Section ${mainSection} (Plan #${sourcePlan.id})`,
      assignments,
      actorUserId: input.actorUserId,
      ipAddress: input.ipAddress,
    });

    let finalStatus = draftResult.status;
    let finalVersion = draftResult.versionNo;

    if (shouldPublish) {
      try {
        const pubResult = await publishTimetablePlan(draftResult.planId, {
          actorUserId: input.actorUserId,
          ipAddress: input.ipAddress,
        });
        finalStatus = pubResult.status;
        finalVersion = pubResult.versionNo;
      } catch (pubErr) {
        console.warn(`Could not auto-publish combined section ${targetSection}`, pubErr);
      }
    }

    results.push({
      section: targetSection,
      planId: draftResult.planId,
      status: finalStatus,
      versionNo: finalVersion,
      copiedAssignmentsCount: assignments.length,
    });
  }

  return {
    success: true,
    mainSection,
    sourcePlanId: sourcePlan.id,
    sourcePlanStatus: sourcePlan.status,
    totalAssignments: assignments.length,
    results,
    message: `Successfully combined timetable: Section ${mainSection} copied to Section${results.length > 1 ? "s" : ""} ${results.map((r) => r.section).join(", ")}.`,
  };
}

export type CombinedBranchesOverviewFilters = {
  collegeId: number;
  courseId: number;
  academicYear: string;
  batch?: string | null;
  year?: number | null;
  semester: number;
  section?: string | null;
};

export async function getCombinedBranchesOverview(filters: CombinedBranchesOverviewFilters) {
  // 1. Get all branches for this course
  const branchRows = await queryStudent<
    (RowDataPacket & {
      id: number;
      name: string;
      code: string | null;
      course_id: number;
      metadata?: string | unknown;
    })[]
  >(
    `
    SELECT id, name, code, course_id, metadata
    FROM course_branches
    WHERE course_id = ? AND (is_active = 1 OR is_active IS NULL)
    ORDER BY name
    `,
    [filters.courseId],
  );

  const branchIds = branchRows.map((b) => b.id);
  if (branchIds.length === 0) {
    return { branches: [], timing: null };
  }

  // 2. Get active timing template for context
  const timing = await getActiveTimingForContext({
    collegeId: filters.collegeId,
    academicYear: filters.academicYear,
    semester: filters.semester,
  });

  // Resolve batch if not explicitly provided
  const resolvedBatch =
    filters.batch?.trim() ||
    (filters.academicYear && filters.year
      ? String(Number(filters.academicYear.slice(0, 4)) - (filters.year - 1))
      : null);

  // 3. Get plans for each branch
  const secFilter = filters.section && filters.section !== "all" ? filters.section : null;
  const planRows = await queryAcademic<(PlanRow & { timing_template_name?: string })[]>(
    `
    SELECT p.*, tt.name AS timing_template_name
    FROM ap_timetable_plans p
    LEFT JOIN ap_timing_templates tt ON tt.id = p.timing_template_id
    WHERE p.academic_year_label = ?
      AND p.college_id = ?
      AND p.course_id = ?
      AND p.branch_id IN (${branchIds.map(() => "?").join(",")})
      AND (? IS NULL OR p.batch = ? OR p.batch = '' OR p.batch IS NULL)
      AND p.semester_number = ?
      AND (? IS NULL OR p.section_name = ? OR p.section_name IS NULL)
      AND p.status IN ('published', 'in_review', 'draft')
    ORDER BY FIELD(p.status, 'published', 'in_review', 'draft'), p.version_no DESC, p.id DESC
    `,
    [
      filters.academicYear,
      filters.collegeId,
      filters.courseId,
      ...branchIds,
      resolvedBatch,
      resolvedBatch,
      filters.semester,
      secFilter,
      secFilter,
    ],
  );

  // Group latest plan per branch
  const planByBranch = new Map<number, PlanRow & { timing_template_name?: string }>();
  for (const row of planRows) {
    if (!planByBranch.has(row.branch_id)) {
      planByBranch.set(row.branch_id, row);
    }
  }

  // 4. For branches with plans, load their entries
  const branchDetails = [];
  for (const branch of branchRows) {
    const plan = planByBranch.get(branch.id);
    let entriesSummary: Array<{
      id: number;
      dayOfWeek: string;
      timingSlotId: number;
      subjectId: number | null;
      subjectCode: string | null;
      subjectName: string | null;
      subjectTypeSnapshot?: string | null;
      entryType: string;
      facultyStaffLinkId: number | null;
      facultyName: string | null;
      facultyHrmsId: string | null;
      roomLabel: string | null;
      batchLabel: string | null;
      customLabel: string | null;
      weeklyRotation?: boolean;
      rotationPattern?: string | null;
    }> = [];

    if (plan) {
      const rawEntries = await loadEntries(plan.id);
      entriesSummary = rawEntries.map((e) => ({
        id: e.id,
        dayOfWeek: e.day_of_week,
        timingSlotId: e.timing_slot_id ?? e.period_slot_id,
        subjectId: e.subject_id,
        subjectCode: e.subject_code,
        subjectName: e.subject_name,
        subjectTypeSnapshot: e.subject_type_snapshot,
        entryType: e.entry_type,
        facultyStaffLinkId: e.faculty_staff_link_id,
        facultyName: e.faculty_name ?? null,
        facultyHrmsId: e.faculty_hrms_id ?? null,
        roomLabel: e.room_label,
        batchLabel: e.batch_label ?? null,
        customLabel: e.custom_label ?? null,
        weeklyRotation: Boolean(e.weekly_rotation),
        rotationPattern: e.rotation_pattern ?? null,
      }));
    }

    branchDetails.push({
      branchId: branch.id,
      branchName: branch.name,
      branchCode: branch.code,
      plan: plan
        ? {
            id: plan.id,
            status: plan.status,
            versionNo: plan.version_no,
            timingTemplateName: plan.timing_template_name ?? null,
            sectionName: plan.section_name ?? null,
            notes: plan.notes ?? null,
            assignedCount: entriesSummary.length,
            entries: entriesSummary,
          }
        : null,
    });
  }

  return {
    branches: branchDetails,
    timing: timing
      ? {
          id: timing.id,
          name: timing.name,
          academicYear: timing.academicYear,
          semester: timing.semester,
          slots: timing.slots,
        }
      : null,
  };
}

export async function getCombinedSubjects(filters: {
  collegeId: number;
  courseId: number;
  batch?: string | null;
  year?: number | null;
  semester: number;
  branchIds: number[];
  academicYear?: string | null;
}) {
  if (!filters.branchIds || filters.branchIds.length === 0) {
    return [];
  }

  const resolvedBatch =
    filters.batch?.trim() ||
    (filters.academicYear && filters.year
      ? String(Number(filters.academicYear.slice(0, 4)) - (filters.year - 1))
      : null);

  const where: string[] = [
    "sme.collegeId = ?",
    "sme.courseId = ?",
    `sme.branchId IN (${filters.branchIds.map(() => "?").join(",")})`,
    "(s.status = 'active' OR s.status IS NULL OR s.status = '')",
  ];
  const params: unknown[] = [
    filters.collegeId,
    filters.courseId,
    ...filters.branchIds,
  ];

  if (resolvedBatch) {
    where.push("(sme.batch = ? OR sme.batch IS NULL OR sme.batch = '')");
    params.push(resolvedBatch);
  }

  if (filters.year != null) {
    where.push("sme.yearOfStudy = ?");
    params.push(filters.year);
  }
  if (filters.semester != null) {
    where.push("sme.semester = ?");
    params.push(filters.semester);
  }

  const rows = await queryExam<
    (RowDataPacket & {
      id: number;
      code: string;
      name: string;
      type: string;
      semester: number | null;
      yearOfStudy: number | null;
      branchId: number;
      branchName: string | null;
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
      sme.branchId,
      sme.branchName
    FROM subject_mapping_entries sme
    INNER JOIN subjects s ON s.id = sme.subjectId
    WHERE ${where.join(" AND ")}
    ORDER BY s.code, sme.id
    LIMIT 400
    `,
    params,
  );

  const subjectMap = new Map<
    number,
    {
      id: number;
      code: string;
      name: string;
      type: string;
      semester: number | null;
      year: number | null;
      branchIds: number[];
      branchNames: string[];
      isCommon: boolean;
    }
  >();

  for (const r of rows) {
    const existing = subjectMap.get(r.id);
    if (!existing) {
      subjectMap.set(r.id, {
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        semester: r.semester,
        year: r.yearOfStudy,
        branchIds: [r.branchId],
        branchNames: r.branchName ? [r.branchName] : [],
        isCommon: false,
      });
    } else {
      if (!existing.branchIds.includes(r.branchId)) {
        existing.branchIds.push(r.branchId);
      }
      if (r.branchName && !existing.branchNames.includes(r.branchName)) {
        existing.branchNames.push(r.branchName);
      }
    }
  }

  const totalSelectedBranches = filters.branchIds.length;
  const list = Array.from(subjectMap.values()).map((s) => ({
    ...s,
    isCommon: totalSelectedBranches > 1 && s.branchIds.length >= totalSelectedBranches,
  }));

  return list.sort((a, b) => {
    if (a.isCommon && !b.isCommon) return -1;
    if (!a.isCommon && b.isCommon) return 1;
    return a.code.localeCompare(b.code);
  });
}

export async function saveCombinedTimetable(input: {
  collegeId: number;
  courseId: number;
  branchIds: number[];
  academicYear: string;
  batch?: string | null;
  year?: number | null;
  semester: number;
  section?: string | null;
  notes?: string | null;
  assignments: AssignmentInput[];
  publish?: boolean;
  actorUserId?: number | null;
  ipAddress?: string | null;
}) {
  const branchIds = (input.branchIds ?? []).map(Number).filter((id) => id > 0);
  if (branchIds.length === 0) {
    throw new Error("Please select at least one branch for the combination.");
  }

  const resolvedBatch =
    input.batch?.trim() ||
    (input.academicYear && input.year
      ? String(Number(input.academicYear.slice(0, 4)) - (input.year - 1))
      : String(Number(input.academicYear.slice(0, 4))));

  const results: Array<{
    branchId: number;
    planId: number;
    status: string;
    versionNo: number;
    assignedCount: number;
  }> = [];

  for (const branchId of branchIds) {
    const draftResult = await saveTimetableDraft({
      collegeId: input.collegeId,
      courseId: input.courseId,
      branchId,
      academicYear: input.academicYear,
      batch: resolvedBatch,
      year: input.year ?? null,
      semester: input.semester,
      section: input.section && input.section !== "all" ? input.section : null,
      notes: input.notes ?? `Combined classes across ${branchIds.length} branches`,
      assignments: input.assignments,
      actorUserId: input.actorUserId,
      ipAddress: input.ipAddress,
    });

    let finalStatus = draftResult.status;
    let finalVersion = draftResult.versionNo;

    if (input.publish) {
      try {
        const pubResult = await publishTimetablePlan(draftResult.planId, {
          actorUserId: input.actorUserId,
          ipAddress: input.ipAddress,
        });
        finalStatus = pubResult.status;
        finalVersion = pubResult.versionNo;
      } catch (pubErr) {
        console.warn(`Could not auto-publish combined timetable for branch ${branchId}:`, pubErr);
      }
    }

    results.push({
      branchId,
      planId: draftResult.planId,
      status: finalStatus,
      versionNo: finalVersion,
      assignedCount: input.assignments.length,
    });
  }

  return {
    success: true,
    totalBranches: branchIds.length,
    totalAssignments: input.assignments.length,
    published: Boolean(input.publish),
    results,
    message: `Successfully ${input.publish ? "published" : "saved draft"} combined timetable for ${branchIds.length} branches (${input.assignments.length} periods assigned).`,
  };
}

export async function cloneCombinedTimetable(input: {
  collegeId: number;
  courseId: number;
  sourceBranchId: number;
  sourceSection?: string | null;
  targetBranchIds: number[];
  academicYear: string;
  batch: string;
  year?: number | null;
  semester: number;
  publish?: boolean;
  actorUserId?: number | null;
  ipAddress?: string | null;
}) {
  const targetBranchIds = (input.targetBranchIds ?? [])
    .map(Number)
    .filter((id) => id > 0 && id !== input.sourceBranchId);

  if (targetBranchIds.length === 0) {
    throw new Error("Please select at least one target branch different from the source branch.");
  }

  const secFilter = input.sourceSection && input.sourceSection !== "all" ? input.sourceSection : null;
  const sourcePlans = await queryAcademic<PlanRow[]>(
    `
    SELECT * FROM ap_timetable_plans
    WHERE academic_year_label = ?
      AND college_id = ?
      AND course_id = ?
      AND branch_id = ?
      AND batch = ?
      AND semester_number = ?
      AND (? IS NULL OR section_name = ? OR section_name IS NULL)
      AND status IN ('published', 'in_review', 'draft')
    ORDER BY CASE status WHEN 'published' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END, id DESC
    LIMIT 1
    `,
    [
      input.academicYear,
      input.collegeId,
      input.courseId,
      input.sourceBranchId,
      input.batch,
      input.semester,
      secFilter,
      secFilter,
    ],
  );

  const sourcePlan = sourcePlans[0];
  if (!sourcePlan) {
    throw new Error("No timetable plan found for the source branch.");
  }

  const sourceEntries = await loadEntries(sourcePlan.id);
  if (sourceEntries.length === 0) {
    throw new Error("Source branch timetable has no periods assigned yet.");
  }

  const sourceSlots = sourcePlan.timing_template_id
    ? await listTimingSlots(sourcePlan.timing_template_id)
    : [];

  const targetTiming = await getActiveTimingForContext({
    collegeId: input.collegeId,
    academicYear: input.academicYear,
    semester: input.semester,
  });
  if (!targetTiming) {
    throw new Error("Active timing template not found for year/semester.");
  }

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
      batchLabel: entry.batch_label ?? "",
      weeklyRotation: Boolean(entry.weekly_rotation),
      rotationPattern: entry.rotation_pattern ?? null,
    });
  }

  if (assignments.length === 0) {
    throw new Error("Could not map any period slots from the source branch to the target timing template.");
  }

  return saveCombinedTimetable({
    collegeId: input.collegeId,
    courseId: input.courseId,
    branchIds: targetBranchIds,
    academicYear: input.academicYear,
    batch: input.batch,
    year: input.year,
    semester: input.semester,
    notes: `Replicated from Branch #${input.sourceBranchId} (Plan #${sourcePlan.id})`,
    assignments,
    publish: input.publish,
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
      semester_number: number | null;
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

export async function listTimetableReportRows(filters: TimetablePlannerFilters = {}) {
  const where = ["p.academic_year_label = ?", "p.status NOT IN ('superseded', 'archived')"];
  const params: unknown[] = [filters.academicYear ?? ""];
  if (filters.collegeId) {
    where.push("p.college_id = ?");
    params.push(filters.collegeId);
  }
  if (filters.courseId) {
    where.push("p.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("p.branch_id = ?");
    params.push(filters.branchId);
  }
  const rows = await queryAcademic<
    (RowDataPacket & {
      plan_id: number;
      college_id: number;
      course_id: number;
      branch_id: number;
      batch: string;
      section_name: string | null;
      status: string;
      day_of_week: string | null;
      period_slot_id: number | null;
      subject_code: string | null;
      subject_name: string | null;
      custom_label: string | null;
      room_label: string | null;
      slot_label: string | null;
      slot_start: string | null;
      slot_end: string | null;
      slot_type: string | null;
      slot_order: number | null;
      faculty_name: string | null;
    })[]
  >(
    `
    SELECT p.id AS plan_id, p.college_id, p.course_id, p.branch_id, p.batch,
               p.section_name, p.status, p.semester_number, e.day_of_week, e.period_slot_id,
              e.subject_code, e.subject_name, e.custom_label, e.room_label,
              s.label AS slot_label, s.start_time AS slot_start, s.end_time AS slot_end,
              s.slot_type, s.slot_order, sl.display_name AS faculty_name
    FROM ap_timetable_plans p
    LEFT JOIN ap_timetable_entries e ON e.plan_id = p.id
    LEFT JOIN ap_timing_templates t ON t.college_id = p.college_id
      AND t.academic_year_label = p.academic_year_label
      AND t.semester_number = p.semester_number
      AND t.status = 'active'
    LEFT JOIN ap_timing_template_slots s ON s.template_id = t.id
      AND s.id = COALESCE(e.timing_slot_id, e.period_slot_id)
            LEFT JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
    WHERE ${where.join(" AND ")}
    ORDER BY p.college_id, p.course_id, p.branch_id, p.batch, p.section_name,
             e.day_of_week, e.period_slot_id
    `,
    params,
  );
  const timingCache = new Map<string, Awaited<ReturnType<typeof listTimingSlots>>>();
  for (const row of rows) {
    const key = `${row.college_id}:${filters.academicYear}:${row.semester_number ?? 0}`;
    if (timingCache.has(key) || !row.semester_number || !filters.academicYear) continue;
    const timing = await getActiveTimingForContext({
      collegeId: Number(row.college_id),
      academicYear: filters.academicYear,
      semester: Number(row.semester_number),
    });
    timingCache.set(key, timing ? await listTimingSlots(timing.id) : []);
  }
  const mapped = rows.map((row) => {
    const slots = timingCache.get(`${row.college_id}:${filters.academicYear}:${row.semester_number ?? 0}`) ?? [];
    const slot = slots.find((item) => item.id === Number(row.period_slot_id)) ??
      slots.find((item) => item.slotOrder === Number(row.period_slot_id));
    return {
    planId: Number(row.plan_id),
    collegeId: Number(row.college_id),
    courseId: Number(row.course_id),
    branchId: Number(row.branch_id),
    batch: row.batch,
    section: row.section_name,
    status: row.status,
    day: row.day_of_week,
    slotId: row.period_slot_id,
    label: row.subject_code || row.custom_label || row.subject_name || "Unassigned",
    subjectName: row.subject_name,
    room: row.room_label,
    slotLabel: slot?.label ?? row.slot_label,
    startTime: slot?.startTime ?? row.slot_start,
    endTime: slot?.endTime ?? row.slot_end,
    slotType: slot?.slotType ?? row.slot_type,
    slotOrder: slot?.slotOrder ?? row.slot_order,
    facultyName: row.faculty_name,
    };
  });
  const planKeys = new Map<string, typeof mapped[number]>();
  for (const row of mapped) {
    planKeys.set(`${row.planId}:${row.batch}`, row);
  }
  for (const sample of planKeys.values()) {
    const slots = timingCache.get(`${sample.collegeId}:${filters.academicYear}:${rows.find((row) => Number(row.plan_id) === sample.planId)?.semester_number ?? 0}`) ?? [];
    const existingSlotIds = new Set(mapped.filter((row) => row.planId === sample.planId).map((row) => row.slotId));
    for (const slot of slots) {
      if (existingSlotIds.has(slot.id)) continue;
      mapped.push({
        ...sample,
        day: null,
        slotId: slot.id,
        label: "",
        subjectName: null,
        room: null,
        slotLabel: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotType: slot.slotType,
        slotOrder: slot.slotOrder,
        facultyName: null,
      });
    }
  }
  return mapped;
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

export type TimetableRosterStudent = {
  id: number;
  pin_no: string | null;
  student_name: string | null;
  admission_number: string;
  section: string | null;
  batch: string | null;
  current_year: number | null;
  current_semester: number | null;
};

export async function getTimetableRoster(
  filters: TimetablePlannerFilters,
): Promise<TimetableRosterStudent[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.collegeId) {
    where.push("s.college_id = ?");
    params.push(filters.collegeId);
  }
  if (filters.branchId) {
    where.push("s.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds && filters.branchIds.length > 0) {
    where.push(`s.branch_id IN (${filters.branchIds.map(() => "?").join(", ")})`);
    params.push(...filters.branchIds);
  }
  if (filters.courseId) {
    where.push("s.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.year != null) {
    where.push("s.current_year = ?");
    params.push(filters.year);
  }
  if (filters.batch) {
    const rawBatch = String(filters.batch).trim();
    const fourDigit = rawBatch.slice(0, 4);
    where.push("(TRIM(s.batch) = ? OR TRIM(s.batch) = ? OR s.batch LIKE ?)");
    params.push(rawBatch, fourDigit, `${fourDigit}%`);
  }

  // Base query (without section constraint)
  const baseSql = `
    SELECT DISTINCT
      s.id,
      s.pin_no,
      s.student_name,
      s.admission_number,
      COALESCE(ss.section_name, s.section) AS section,
      s.batch,
      s.current_year,
      s.current_semester
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    WHERE ${where.length > 0 ? where.join(" AND ") : "1=1"}
  `;

  // First attempt: with section if provided and not "all"
  let rows: (RowDataPacket & TimetableRosterStudent)[] = [];
  const hasSection = Boolean(filters.section && filters.section !== "all");

  if (hasSection) {
    const sectionSql = `${baseSql} AND (s.section = ? OR ss.section_name = ?) ORDER BY COALESCE(s.pin_no, s.admission_number, s.id) ASC LIMIT 500`;
    rows = await queryStudent<(RowDataPacket & TimetableRosterStudent)[]>(
      sectionSql,
      [...params, filters.section, filters.section],
    );
  }

  // Fallback 1: if section had 0 students (or no section specified), query without section filter
  if (rows.length === 0) {
    const fallbackSql = `${baseSql} ORDER BY COALESCE(s.pin_no, s.admission_number, s.id) ASC LIMIT 500`;
    rows = await queryStudent<(RowDataPacket & TimetableRosterStudent)[]>(
      fallbackSql,
      params,
    );
  }

  // Fallback 2: if still 0 rows and batch was specified, try without batch restriction (match by year/branch)
  if (rows.length === 0 && filters.batch && filters.year != null) {
    const noBatchWhere = where.filter((w) => !w.includes("s.batch"));
    const noBatchParams: unknown[] = [];
    if (filters.collegeId) noBatchParams.push(filters.collegeId);
    if (filters.branchId) noBatchParams.push(filters.branchId);
    else if (filters.branchIds && filters.branchIds.length > 0) noBatchParams.push(...filters.branchIds);
    if (filters.courseId) noBatchParams.push(filters.courseId);
    if (filters.year != null) noBatchParams.push(filters.year);

    const wideSql = `
      SELECT DISTINCT
        s.id,
        s.pin_no,
        s.student_name,
        s.admission_number,
        COALESCE(ss.section_name, s.section) AS section,
        s.batch,
        s.current_year,
        s.current_semester
      FROM students s
      LEFT JOIN student_sections ss ON ss.student_id = s.id
      WHERE ${noBatchWhere.length > 0 ? noBatchWhere.join(" AND ") : "1=1"}
      ORDER BY COALESCE(s.pin_no, s.admission_number, s.id) ASC
      LIMIT 500
    `;
    rows = await queryStudent<(RowDataPacket & TimetableRosterStudent)[]>(
      wideSql,
      noBatchParams,
    );
  }

  return rows.map((r) => ({
    id: Number(r.id),
    pin_no: r.pin_no ?? null,
    student_name: r.student_name ?? null,
    admission_number: r.admission_number ?? "",
    section: r.section ?? null,
    batch: r.batch ?? null,
    current_year: r.current_year != null ? Number(r.current_year) : null,
    current_semester: r.current_semester != null ? Number(r.current_semester) : null,
  }));
}

export { getTimingTemplateDetail };
