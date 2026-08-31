import type { PoolConnection, RowDataPacket } from "mysql2";
import {
  executeAcademic,
  queryAcademic,
  queryStudent,
  withAcademicTransaction,
} from "../db/pools.js";
import type { AuthzContext } from "../authz/authorization.service.js";
import {
  assertEntityInScope,
  hasPermission,
} from "../authz/authorization.service.js";
import type { DayCode } from "./timing.service.js";
import { DAY_CODE_TO_LABEL } from "./timing.service.js";
import {
  ensureSessionsForDate,
  getClassSessionById,
} from "./class-sessions.service.js";
import { writeAuditLog } from "./audit.service.js";

export const SUBSTITUTION_TYPE_KEY = "faculty_substitution";

type PlanEntryRow = RowDataPacket & {
  entry_id: number;
  plan_id: number;
  college_id: number;
  course_id: number;
  branch_id: number;
  batch: string;
  year_of_study: number | null;
  semester_number: number | null;
  section_name: string | null;
  academic_year_label: string;
  timing_template_id: number | null;
  day_of_week: DayCode;
  timing_slot_id: number;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  faculty_staff_link_id: number | null;
  room_label: string | null;
  slot_label: string;
  start_time: string;
  end_time: string;
  faculty_name: string | null;
  faculty_hrms_id: string | null;
};

type SubstitutionDetailRow = RowDataPacket & {
  id: number;
  request_id: number;
  session_date: string;
  timetable_entry_id: number;
  plan_id: number;
  class_session_id: number | null;
  college_id: number;
  course_id: number;
  branch_id: number;
  batch: string;
  year_of_study: number | null;
  semester_number: number | null;
  section_name: string;
  timing_slot_id: number;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  room_label: string | null;
  original_faculty_staff_link_id: number;
  replacement_faculty_staff_link_id: number;
  reason: string;
  execution_status: string;
  execution_error: string | null;
  applied_at: string | null;
  original_faculty_name?: string | null;
  replacement_faculty_name?: string | null;
  slot_label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function dayCodeFromDate(value: string): DayCode {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) fail(400, "Invalid session date");
  const map: DayCode[] = ["SUN", "MON", "TUE", "WED", "THUR", "FRI", "SAT"];
  return map[d.getDay()]!;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function mapSubstitutionDetail(row: SubstitutionDetailRow) {
  return {
    id: Number(row.id),
    requestId: Number(row.request_id),
    sessionDate: String(row.session_date).slice(0, 10),
    timetableEntryId: Number(row.timetable_entry_id),
    planId: Number(row.plan_id),
    classSessionId: row.class_session_id != null ? Number(row.class_session_id) : null,
    collegeId: Number(row.college_id),
    courseId: Number(row.course_id),
    branchId: Number(row.branch_id),
    batch: row.batch,
    yearOfStudy: row.year_of_study != null ? Number(row.year_of_study) : null,
    semesterNumber: row.semester_number != null ? Number(row.semester_number) : null,
    sectionName: row.section_name,
    timingSlotId: Number(row.timing_slot_id),
    subjectId: row.subject_id != null ? Number(row.subject_id) : null,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    roomLabel: row.room_label,
    originalFacultyStaffLinkId: Number(row.original_faculty_staff_link_id),
    replacementFacultyStaffLinkId: Number(row.replacement_faculty_staff_link_id),
    originalFacultyName: row.original_faculty_name ?? null,
    replacementFacultyName: row.replacement_faculty_name ?? null,
    slotLabel: row.slot_label ?? null,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    reason: row.reason,
    executionStatus: row.execution_status,
    executionError: row.execution_error,
    appliedAt: row.applied_at,
  };
}

async function resolveRequesterStaffLinkId(userId: number): Promise<number | null> {
  const rows = await queryAcademic<(RowDataPacket & { staff_link_id: number | null })[]>(
    `
    SELECT sl.id AS staff_link_id
    FROM ap_users u
    LEFT JOIN ap_staff_link sl ON sl.hrms_employee_id = u.hrms_employee_id
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId],
  );
  const id = rows[0]?.staff_link_id;
  return id != null ? Number(id) : null;
}

async function assertScope(authz: AuthzContext, collegeId: number, branchId: number) {
  if (authz.scope.isGlobal) return;
  try {
    assertEntityInScope(authz, { collegeId, branchId });
  } catch {
    fail(403, "Forbidden for this academic scope");
  }
}

export async function resolveClassAssignment(
  authz: AuthzContext,
  input: {
    sessionDate: string;
    collegeId: number;
    courseId: number;
    branchId: number;
    batch: string;
    yearOfStudy?: number;
    semesterNumber?: number;
    sectionName: string;
    timingSlotId: number;
    academicYear?: string;
  },
) {
  if (!hasPermission(authz, "request.create") && !hasPermission(authz, "request.view")) {
    fail(403, "Forbidden");
  }
  if (!isIsoDate(input.sessionDate)) fail(400, "sessionDate must be YYYY-MM-DD");
  await assertScope(authz, input.collegeId, input.branchId);

  const dayOfWeek = dayCodeFromDate(input.sessionDate);
  const where = [
    "p.status = 'published'",
    "p.college_id = ?",
    "p.course_id = ?",
    "p.branch_id = ?",
    "p.batch = ?",
    "p.section_name = ?",
    "e.day_of_week = ?",
    "COALESCE(e.timing_slot_id, e.period_slot_id) = ?",
    "e.subject_id IS NOT NULL",
    "s.slot_type = 'CLASS'",
  ];
  const params: unknown[] = [
    input.collegeId,
    input.courseId,
    input.branchId,
    input.batch,
    input.sectionName,
    dayOfWeek,
    input.timingSlotId,
  ];

  if (input.yearOfStudy != null) {
    where.push("p.year_of_study = ?");
    params.push(input.yearOfStudy);
  }
  if (input.semesterNumber != null) {
    where.push("p.semester_number = ?");
    params.push(input.semesterNumber);
  }
  if (input.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(input.academicYear);
  }

  const rows = await queryAcademic<PlanEntryRow[]>(
    `
    SELECT
      e.id AS entry_id,
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
      e.day_of_week,
      COALESCE(e.timing_slot_id, e.period_slot_id) AS timing_slot_id,
      e.subject_id,
      e.subject_code,
      e.subject_name,
      e.faculty_staff_link_id,
      e.room_label,
      ts.label AS slot_label,
      ts.start_time,
      ts.end_time,
      sl.display_name AS faculty_name,
      sl.hrms_employee_id AS faculty_hrms_id
    FROM ap_timetable_entries e
    INNER JOIN ap_timetable_plans p ON p.id = e.plan_id
    INNER JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(e.timing_slot_id, e.period_slot_id)
    LEFT JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
    WHERE ${where.join(" AND ")}
    ORDER BY p.version_no DESC, p.id DESC
    LIMIT 1
    `,
    params,
  );

  const row = rows[0];
  if (!row) {
    fail(404, "No published class assignment found for the selected date, section, and period");
  }
  if (!row.faculty_staff_link_id) {
    fail(400, "Selected class has no assigned faculty in the published timetable");
  }

  const dayLabel = DAY_CODE_TO_LABEL[row.day_of_week] ?? row.day_of_week;
  return {
    timetableEntryId: Number(row.entry_id),
    planId: Number(row.plan_id),
    collegeId: Number(row.college_id),
    courseId: Number(row.course_id),
    branchId: Number(row.branch_id),
    batch: row.batch,
    yearOfStudy: row.year_of_study != null ? Number(row.year_of_study) : null,
    semesterNumber: row.semester_number != null ? Number(row.semester_number) : null,
    sectionName: row.section_name ?? input.sectionName,
    academicYear: row.academic_year_label,
    timingSlotId: Number(row.timing_slot_id),
    dayOfWeek: row.day_of_week,
    dayLabel,
    subjectId: row.subject_id != null ? Number(row.subject_id) : null,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    roomLabel: row.room_label,
    originalFacultyStaffLinkId: Number(row.faculty_staff_link_id),
    originalFacultyName: row.faculty_name,
    originalFacultyHrmsId: row.faculty_hrms_id,
    slotLabel: row.slot_label,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
  };
}

async function facultyBusyOnSlot(
  staffLinkId: number,
  sessionDate: string,
  timingSlotId: number,
  excludeTimetableEntryId?: number,
) {
  const rows = await queryAcademic<(RowDataPacket & { id: number; subject_name: string | null; section_name: string | null })[]>(
    `
    SELECT cs.id, cs.subject_name, cs.section_name
    FROM ap_class_sessions cs
    WHERE cs.session_date = ?
      AND cs.faculty_staff_link_id = ?
      AND COALESCE(cs.timing_slot_id, cs.period_slot_id) = ?
      AND cs.status NOT IN ('cancelled', 'holiday')
      AND (? IS NULL OR cs.timetable_entry_id <> ?)
    LIMIT 1
    `,
    [sessionDate, staffLinkId, timingSlotId, excludeTimetableEntryId ?? null, excludeTimetableEntryId ?? null],
  );
  return rows[0] ?? null;
}

async function hasConflictingSubstitution(input: {
  sessionDate: string;
  timetableEntryId: number;
  timingSlotId: number;
  branchId: number;
  sectionName: string;
  excludeRequestId?: number;
}) {
  const rows = await queryAcademic<(RowDataPacket & { request_id: number })[]>(
    `
    SELECT d.request_id
    FROM ap_faculty_substitution_details d
    INNER JOIN ap_requests r ON r.id = d.request_id
    WHERE d.session_date = ?
      AND d.timetable_entry_id = ?
      AND d.timing_slot_id = ?
      AND d.branch_id = ?
      AND d.section_name = ?
      AND d.execution_status IN ('pending', 'applied')
      AND r.status IN ('draft', 'submitted', 'pending_approval', 'returned', 'approved')
      AND (? IS NULL OR d.request_id <> ?)
    LIMIT 1
    `,
    [
      input.sessionDate,
      input.timetableEntryId,
      input.timingSlotId,
      input.branchId,
      input.sectionName,
      input.excludeRequestId ?? null,
      input.excludeRequestId ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function listReplacementFacultyAvailability(
  authz: AuthzContext,
  input: {
    sessionDate: string;
    collegeId: number;
    branchId: number;
    timingSlotId: number;
    timetableEntryId: number;
    search?: string;
    limit?: number;
  },
) {
  if (!hasPermission(authz, "request.create")) fail(403, "Forbidden");
  if (!isIsoDate(input.sessionDate)) fail(400, "sessionDate must be YYYY-MM-DD");
  await assertScope(authz, input.collegeId, input.branchId);

  await ensureSessionsForDate(input.sessionDate, {
    collegeId: input.collegeId,
    branchId: input.branchId,
  });

  const q = input.search?.trim().toLowerCase();
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);

  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      display_name: string;
      hrms_employee_id: string;
      department_name: string | null;
    })[]
  >(
    `
    SELECT DISTINCT sl.id, sl.display_name, sl.hrms_employee_id, sl.department_name
    FROM ap_staff_link sl
    WHERE (? IS NULL OR LOWER(sl.display_name) LIKE ? OR LOWER(sl.hrms_employee_id) LIKE ?)
    ORDER BY sl.display_name ASC
    LIMIT ?
    `,
    [q ?? null, q ? `%${q}%` : null, q ? `%${q}%` : null, limit],
  );

  const availability = [];
  for (const row of rows) {
    const staffLinkId = Number(row.id);
    const busy = await facultyBusyOnSlot(
      staffLinkId,
      input.sessionDate,
      input.timingSlotId,
      input.timetableEntryId,
    );
    availability.push({
      staffLinkId,
      name: row.display_name,
      hrmsEmployeeId: row.hrms_employee_id,
      department: row.department_name,
      available: !busy,
      busyWith:
        busy != null
          ? {
              subjectName: busy.subject_name,
              sectionName: busy.section_name,
            }
          : null,
    });
  }

  return availability;
}

export async function listTimingSlotsForSubstitution(
  authz: AuthzContext,
  input: {
    collegeId: number;
    courseId: number;
    branchId: number;
    batch: string;
    yearOfStudy?: number;
    semesterNumber?: number;
    sectionName: string;
    academicYear?: string;
    sessionDate: string;
  },
) {
  if (!hasPermission(authz, "request.create") && !hasPermission(authz, "request.view")) {
    fail(403, "Forbidden");
  }
  await assertScope(authz, input.collegeId, input.branchId);
  const dayOfWeek = dayCodeFromDate(input.sessionDate);

  const where = [
    "p.status = 'published'",
    "p.college_id = ?",
    "p.course_id = ?",
    "p.branch_id = ?",
    "p.batch = ?",
    "p.section_name = ?",
    "e.day_of_week = ?",
    "e.subject_id IS NOT NULL",
    "ts.slot_type = 'CLASS'",
  ];
  const params: unknown[] = [
    input.collegeId,
    input.courseId,
    input.branchId,
    input.batch,
    input.sectionName,
    dayOfWeek,
  ];
  if (input.yearOfStudy != null) {
    where.push("p.year_of_study = ?");
    params.push(input.yearOfStudy);
  }
  if (input.semesterNumber != null) {
    where.push("p.semester_number = ?");
    params.push(input.semesterNumber);
  }
  if (input.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(input.academicYear);
  }

  const rows = await queryAcademic<
    (RowDataPacket & {
      timing_slot_id: number;
      slot_label: string;
      start_time: string;
      end_time: string;
      subject_name: string | null;
    })[]
  >(
    `
    SELECT DISTINCT
      COALESCE(e.timing_slot_id, e.period_slot_id) AS timing_slot_id,
      ts.label AS slot_label,
      ts.start_time,
      ts.end_time,
      e.subject_name
    FROM ap_timetable_entries e
    INNER JOIN ap_timetable_plans p ON p.id = e.plan_id
    INNER JOIN ap_timing_template_slots ts ON ts.id = COALESCE(e.timing_slot_id, e.period_slot_id)
    WHERE ${where.join(" AND ")}
    ORDER BY ts.start_time ASC, ts.slot_order ASC
    `,
    params,
  );

  return rows.map((row) => ({
    timingSlotId: Number(row.timing_slot_id),
    slotLabel: row.slot_label,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    subjectName: row.subject_name,
  }));
}

export async function createSubstitutionDetails(
  authz: AuthzContext,
  requestId: number,
  input: {
    sessionDate: string;
    timetableEntryId: number;
    replacementFacultyStaffLinkId: number;
    reason: string;
    collegeId: number;
    courseId: number;
    branchId: number;
    batch: string;
    yearOfStudy?: number;
    semesterNumber?: number;
    sectionName: string;
    timingSlotId: number;
    academicYear?: string;
  },
  ipAddress?: string | null,
) {
  if (!hasPermission(authz, "request.create")) fail(403, "Forbidden");

  const assignment = await resolveClassAssignment(authz, {
    sessionDate: input.sessionDate,
    collegeId: input.collegeId,
    courseId: input.courseId,
    branchId: input.branchId,
    batch: input.batch,
    yearOfStudy: input.yearOfStudy,
    semesterNumber: input.semesterNumber,
    sectionName: input.sectionName,
    timingSlotId: input.timingSlotId,
    academicYear: input.academicYear,
  });

  if (assignment.timetableEntryId !== input.timetableEntryId) {
    fail(400, "Timetable assignment mismatch");
  }

  const requesterStaffLinkId = await resolveRequesterStaffLinkId(authz.userId);
  if (
    !authz.scope.isGlobal &&
    requesterStaffLinkId !== assignment.originalFacultyStaffLinkId
  ) {
    fail(403, "You can only request substitution for your own assigned classes");
  }

  if (assignment.originalFacultyStaffLinkId === input.replacementFacultyStaffLinkId) {
    fail(400, "Replacement faculty must be different from the original faculty");
  }

  const replacementRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_staff_link WHERE id = ? LIMIT 1`,
    [input.replacementFacultyStaffLinkId],
  );
  if (!replacementRows[0]) {
    fail(400, "Replacement faculty not found");
  }

  const busy = await facultyBusyOnSlot(
    input.replacementFacultyStaffLinkId,
    input.sessionDate,
    input.timingSlotId,
    input.timetableEntryId,
  );
  if (busy) {
    fail(409, "Replacement faculty is busy during the selected date and period");
  }

  const conflict = await hasConflictingSubstitution({
    sessionDate: input.sessionDate,
    timetableEntryId: input.timetableEntryId,
    timingSlotId: input.timingSlotId,
    branchId: input.branchId,
    sectionName: input.sectionName,
  });
  if (conflict) {
    fail(409, "A pending or approved substitution already exists for this class and date");
  }

  const reason = input.reason?.trim();
  if (!reason) fail(400, "Reason is required");

  await executeAcademic(
    `
    INSERT INTO ap_faculty_substitution_details
      (request_id, session_date, timetable_entry_id, plan_id, college_id, course_id, branch_id,
       batch, year_of_study, semester_number, section_name, timing_slot_id, subject_id,
       subject_code, subject_name, room_label, original_faculty_staff_link_id,
       replacement_faculty_staff_link_id, reason, execution_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `,
    [
      requestId,
      input.sessionDate,
      assignment.timetableEntryId,
      assignment.planId,
      assignment.collegeId,
      assignment.courseId,
      assignment.branchId,
      assignment.batch,
      assignment.yearOfStudy,
      assignment.semesterNumber,
      assignment.sectionName,
      assignment.timingSlotId,
      assignment.subjectId,
      assignment.subjectCode,
      assignment.subjectName,
      assignment.roomLabel,
      assignment.originalFacultyStaffLinkId,
      input.replacementFacultyStaffLinkId,
      reason,
    ],
  );

  await writeAuditLog({
    actorUserId: authz.userId,
    action: "faculty.substitution.requested",
    entityType: "ap_request",
    entityId: requestId,
    newValue: {
      sessionDate: input.sessionDate,
      timetableEntryId: assignment.timetableEntryId,
      replacementFacultyStaffLinkId: input.replacementFacultyStaffLinkId,
    },
    ipAddress,
  });
}

export async function loadSubstitutionDetailByRequestId(requestId: number) {
  const rows = await queryAcademic<SubstitutionDetailRow[]>(
    `
    SELECT
      d.*,
      ofc.display_name AS original_faculty_name,
      rfc.display_name AS replacement_faculty_name,
      ts.label AS slot_label,
      ts.start_time,
      ts.end_time
    FROM ap_faculty_substitution_details d
    LEFT JOIN ap_staff_link ofc ON ofc.id = d.original_faculty_staff_link_id
    LEFT JOIN ap_staff_link rfc ON rfc.id = d.replacement_faculty_staff_link_id
    LEFT JOIN ap_timing_template_slots ts ON ts.id = d.timing_slot_id
    WHERE d.request_id = ?
    LIMIT 1
    `,
    [requestId],
  );
  return rows[0] ? mapSubstitutionDetail(rows[0]) : null;
}

export async function loadSubstitutionSummariesForRequests(requestIds: number[]) {
  if (!requestIds.length) return new Map<number, ReturnType<typeof mapSubstitutionDetail>>();
  const placeholders = requestIds.map(() => "?").join(", ");
  const rows = await queryAcademic<SubstitutionDetailRow[]>(
    `
    SELECT
      d.*,
      ofc.display_name AS original_faculty_name,
      rfc.display_name AS replacement_faculty_name,
      ts.label AS slot_label,
      ts.start_time,
      ts.end_time
    FROM ap_faculty_substitution_details d
    LEFT JOIN ap_staff_link ofc ON ofc.id = d.original_faculty_staff_link_id
    LEFT JOIN ap_staff_link rfc ON rfc.id = d.replacement_faculty_staff_link_id
    LEFT JOIN ap_timing_template_slots ts ON ts.id = d.timing_slot_id
    WHERE d.request_id IN (${placeholders})
    `,
    requestIds,
  );
  const map = new Map<number, ReturnType<typeof mapSubstitutionDetail>>();
  for (const row of rows) {
    map.set(Number(row.request_id), mapSubstitutionDetail(row));
  }
  return map;
}

export async function applyFacultySubstitution(
  requestId: number,
  actorUserId: number,
  ipAddress?: string | null,
) {
  try {
    await withAcademicTransaction(async (conn) => {
      const [detailRows] = await conn.execute(
        `SELECT * FROM ap_faculty_substitution_details WHERE request_id = ? LIMIT 1 FOR UPDATE`,
        [requestId],
      );
      const detail = (detailRows as SubstitutionDetailRow[])[0];
      if (!detail) return;
      if (detail.execution_status === "applied") return;

      await applySubstitutionTransaction(conn, detail, requestId, actorUserId);
    });

    const applied = await queryAcademic<(RowDataPacket & { execution_status: string })[]>(
      `SELECT execution_status FROM ap_faculty_substitution_details WHERE request_id = ? LIMIT 1`,
      [requestId],
    );
    if (!applied[0]) return { applied: false, reason: "not_substitution_request" as const };
    if (applied[0].execution_status !== "applied") {
      return { applied: false, reason: "not_applied" as const };
    }

    await writeAuditLog({
      actorUserId,
      action: "faculty.substitution.applied",
      entityType: "ap_request",
      entityId: requestId,
      newValue: { success: true },
      ipAddress,
    });

    return { applied: true, reason: "applied" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Substitution apply failed";
    await executeAcademic(
      `
      UPDATE ap_faculty_substitution_details
      SET execution_status = 'failed', execution_error = ?
      WHERE request_id = ?
      `,
      [message.slice(0, 2000), requestId],
    );
    await writeAuditLog({
      actorUserId,
      action: "faculty.substitution.applied",
      entityType: "ap_request",
      entityId: requestId,
      newValue: { success: false, error: message },
      ipAddress,
    });
    throw error;
  }
}

async function applySubstitutionTransaction(
  conn: PoolConnection,
  detail: SubstitutionDetailRow,
  requestId: number,
  actorUserId: number,
) {
  await ensureSessionsForDate(String(detail.session_date).slice(0, 10), {
    collegeId: Number(detail.college_id),
    branchId: Number(detail.branch_id),
    batch: detail.batch,
    year: detail.year_of_study ?? undefined,
    semester: detail.semester_number ?? undefined,
    section: detail.section_name,
  });

  const [sessionRows] = await conn.execute(
    `
    SELECT id, faculty_staff_link_id
    FROM ap_class_sessions
    WHERE timetable_entry_id = ? AND session_date = ?
    LIMIT 1
    FOR UPDATE
    `,
    [detail.timetable_entry_id, detail.session_date],
  );
  const session = (sessionRows as RowDataPacket[])[0] as
    | { id: number; faculty_staff_link_id: number | null }
    | undefined;
  if (!session) {
    fail(400, "Class session could not be resolved for the selected date");
  }

  if (Number(session.faculty_staff_link_id) !== Number(detail.original_faculty_staff_link_id)) {
    const activeOverride = await queryAcademic<(RowDataPacket & { id: number })[]>(
      `
      SELECT id FROM ap_class_session_substitutions
      WHERE class_session_id = ? AND status = 'active'
      LIMIT 1
      `,
      [session.id],
    );
    if (!activeOverride[0]) {
      fail(409, "Class session faculty no longer matches the original assignment");
    }
  }

  const [busyRows] = await conn.execute(
    `
    SELECT cs.id, cs.subject_name, cs.section_name
    FROM ap_class_sessions cs
    WHERE cs.session_date = ?
      AND cs.faculty_staff_link_id = ?
      AND COALESCE(cs.timing_slot_id, cs.period_slot_id) = ?
      AND cs.status NOT IN ('cancelled', 'holiday')
      AND cs.timetable_entry_id <> ?
    LIMIT 1
    `,
    [
      String(detail.session_date).slice(0, 10),
      detail.replacement_faculty_staff_link_id,
      detail.timing_slot_id,
      detail.timetable_entry_id,
    ],
  );
  const busy = (busyRows as RowDataPacket[])[0];
  if (busy) {
    fail(409, "Replacement faculty became busy before substitution could be applied");
  }

  await conn.execute(
    `UPDATE ap_class_sessions SET faculty_staff_link_id = ? WHERE id = ?`,
    [detail.replacement_faculty_staff_link_id, session.id],
  );

  await conn.execute(
    `
    INSERT INTO ap_class_session_substitutions
      (request_id, class_session_id, session_date, timetable_entry_id,
       original_faculty_staff_link_id, replacement_faculty_staff_link_id,
       status, applied_at, applied_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), ?)
    `,
    [
      requestId,
      session.id,
      detail.session_date,
      detail.timetable_entry_id,
      detail.original_faculty_staff_link_id,
      detail.replacement_faculty_staff_link_id,
      actorUserId,
    ],
  );

  await conn.execute(
    `
    UPDATE ap_faculty_substitution_details
    SET execution_status = 'applied',
        execution_error = NULL,
        applied_at = NOW(),
        class_session_id = ?
    WHERE request_id = ?
    `,
    [session.id, requestId],
  );
}

export async function markSubstitutionCancelled(requestId: number, actorUserId: number, ipAddress?: string | null) {
  await executeAcademic(
    `
    UPDATE ap_faculty_substitution_details
    SET execution_status = 'cancelled'
    WHERE request_id = ? AND execution_status = 'pending'
    `,
    [requestId],
  );
  await writeAuditLog({
    actorUserId,
    action: "faculty.substitution.cancelled",
    entityType: "ap_request",
    entityId: requestId,
    ipAddress,
  });
}

export async function getMyTimetableDateOverrides(
  staffLinkId: number,
  sessionDate: string,
) {
  if (!isIsoDate(sessionDate)) return { outgoing: [], incoming: [] };

  const outgoing = await queryAcademic<
    (RowDataPacket & {
      class_session_id: number;
      subject_name: string | null;
      section_name: string;
      start_time: string | null;
      end_time: string | null;
      slot_label: string | null;
      replacement_name: string | null;
      request_id: number;
    })[]
  >(
    `
    SELECT
      s.class_session_id,
      cs.subject_name,
      cs.section_name,
      cs.start_time,
      cs.end_time,
      ts.label AS slot_label,
      rfc.display_name AS replacement_name,
      s.request_id
    FROM ap_class_session_substitutions s
    INNER JOIN ap_class_sessions cs ON cs.id = s.class_session_id
    LEFT JOIN ap_timing_template_slots ts ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    LEFT JOIN ap_staff_link rfc ON rfc.id = s.replacement_faculty_staff_link_id
    WHERE s.status = 'active'
      AND s.session_date = ?
      AND s.original_faculty_staff_link_id = ?
    ORDER BY cs.start_time ASC
    `,
    [sessionDate, staffLinkId],
  );

  const incoming = await queryAcademic<
    (RowDataPacket & {
      class_session_id: number;
      subject_name: string | null;
      section_name: string;
      start_time: string | null;
      end_time: string | null;
      slot_label: string | null;
      original_name: string | null;
      request_id: number;
    })[]
  >(
    `
    SELECT
      s.class_session_id,
      cs.subject_name,
      cs.section_name,
      cs.start_time,
      cs.end_time,
      ts.label AS slot_label,
      ofc.display_name AS original_name,
      s.request_id
    FROM ap_class_session_substitutions s
    INNER JOIN ap_class_sessions cs ON cs.id = s.class_session_id
    LEFT JOIN ap_timing_template_slots ts ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    LEFT JOIN ap_staff_link ofc ON ofc.id = s.original_faculty_staff_link_id
    WHERE s.status = 'active'
      AND s.session_date = ?
      AND s.replacement_faculty_staff_link_id = ?
    ORDER BY cs.start_time ASC
    `,
    [sessionDate, staffLinkId],
  );

  return {
    outgoing: outgoing.map((row) => ({
      classSessionId: Number(row.class_session_id),
      subjectName: row.subject_name,
      sectionName: row.section_name,
      startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
      endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
      slotLabel: row.slot_label,
      replacementFacultyName: row.replacement_name,
      requestId: Number(row.request_id),
      kind: "substituted" as const,
    })),
    incoming: incoming.map((row) => ({
      classSessionId: Number(row.class_session_id),
      subjectName: row.subject_name,
      sectionName: row.section_name,
      startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
      endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
      slotLabel: row.slot_label,
      originalFacultyName: row.original_name,
      requestId: Number(row.request_id),
      kind: "substitution" as const,
    })),
  };
}

export async function loadCatalogNames(collegeId: number, courseId: number, branchId: number) {
  const [collegeRows, courseRows, branchRows] = await Promise.all([
    queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM colleges WHERE id = ? LIMIT 1`,
      [collegeId],
    ),
    queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM courses WHERE id = ? LIMIT 1`,
      [courseId],
    ),
    queryStudent<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM course_branches WHERE id = ? LIMIT 1`,
      [branchId],
    ),
  ]);
  return {
    collegeName: collegeRows[0]?.name ?? null,
    courseName: courseRows[0]?.name ?? null,
    branchName: branchRows[0]?.name ?? null,
  };
}
