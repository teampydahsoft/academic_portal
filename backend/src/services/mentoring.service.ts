import type { RowDataPacket } from "mysql2";
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
import {
  getStudentAttendance,
  getStudentById,
  getStudentScope,
  listStudents,
  riskFromAttendance,
  type StudentListFilters,
} from "./students.service.js";
import { writeAuditLog } from "./audit.service.js";

export const RISK_CASE_STATUSES = ["open", "monitoring", "resolved", "escalated"] as const;
export type RiskCaseStatus = (typeof RISK_CASE_STATUSES)[number];

export const INTERVENTION_TYPES = [
  "counselling",
  "parent_communication",
  "academic_support",
  "attendance_follow_up",
  "other",
] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export function currentAcademicYearLabel(date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  if (m >= 5) return `${y}-${y + 1}`;
  return `${y - 1}-${y}`;
}

export function severityFromRisk(risk: "High" | "Medium" | "Low"): "high" | "medium" | "low" {
  if (risk === "High") return "high";
  if (risk === "Medium") return "medium";
  return "low";
}

export function riskReasonFromLevel(risk: "High" | "Medium" | "Low"): string {
  if (risk === "High") return "Overall attendance below 65%";
  if (risk === "Medium") return "Overall attendance between 65% and 74%";
  return "Overall attendance at or above 75%";
}

export async function resolveStaffLinkId(userId: number): Promise<number | null> {
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

export function shouldRestrictToOwnMentees(authz: AuthzContext): boolean {
  return hasPermission(authz, "mentoring.view") && !hasPermission(authz, "mentoring.manage");
}

async function assertStudentAccess(authz: AuthzContext, studentId: string) {
  const scope = await getStudentScope(studentId);
  if (!scope) fail(404, "Student not found");
  assertEntityInScope(authz, scope);
  if (shouldRestrictToOwnMentees(authz)) {
    const staffLinkId = await resolveStaffLinkId(authz.userId);
    if (!staffLinkId) fail(403, "Forbidden");
    const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `
      SELECT COUNT(*) AS c
      FROM ap_mentor_assignments
      WHERE student_db_id = ? AND faculty_staff_link_id = ? AND is_active = 1
      `,
      [studentId, staffLinkId],
    );
    if (Number(rows[0]?.c ?? 0) === 0) fail(403, "Forbidden");
  }
}

export type MentoringListFilters = StudentListFilters & {
  risk?: "High" | "Medium" | "Low" | "all";
  caseStatus?: RiskCaseStatus | "none" | "all";
  mentorStaffLinkId?: number;
  onlyAtRisk?: boolean;
};

export type MentoringDashboardSummary = {
  totalMentees: number;
  highRisk: number;
  mediumRisk: number;
  openCases: number;
  followUpsDue: number;
  escalated: number;
};

export type MentoringStudentRow = {
  id: string;
  name: string;
  rollNo: string | null;
  admissionNo: string;
  college: string;
  course: string;
  branch: string;
  year: number | null;
  semester: number | null;
  section: string;
  attendance: number;
  risk: "High" | "Medium" | "Low";
  riskReason: string;
  mentor: {
    assignmentId: number;
    staffLinkId: number;
    name: string;
  } | null;
  activeCase: {
    id: number;
    status: RiskCaseStatus;
    severity: string;
    openedAt: string;
    escalated: boolean;
  } | null;
};

async function loadActiveMentorsByStudent(studentIds: number[]) {
  const map = new Map<
    number,
    { assignmentId: number; staffLinkId: number; name: string }
  >();
  if (studentIds.length === 0) return map;

  const placeholders = studentIds.map(() => "?").join(", ");
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      student_db_id: number;
      faculty_staff_link_id: number;
      display_name: string | null;
    })[]
  >(
    `
    SELECT ma.id, ma.student_db_id, ma.faculty_staff_link_id, sl.display_name
    FROM ap_mentor_assignments ma
    INNER JOIN ap_staff_link sl ON sl.id = ma.faculty_staff_link_id
    WHERE ma.is_active = 1 AND ma.student_db_id IN (${placeholders})
    ORDER BY ma.created_at DESC
    `,
    studentIds,
  );
  for (const row of rows) {
    const sid = Number(row.student_db_id);
    if (map.has(sid)) continue;
    map.set(sid, {
      assignmentId: Number(row.id),
      staffLinkId: Number(row.faculty_staff_link_id),
      name: row.display_name ?? "Staff",
    });
  }
  return map;
}

async function loadActiveCasesByStudent(studentIds: number[]) {
  const map = new Map<
    number,
    { id: number; status: RiskCaseStatus; severity: string; openedAt: string; escalated: boolean }
  >();
  if (studentIds.length === 0) return map;

  const placeholders = studentIds.map(() => "?").join(", ");
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      student_db_id: number;
      status: RiskCaseStatus;
      severity: string;
      opened_at: string;
    })[]
  >(
    `
    SELECT id, student_db_id, status, severity, opened_at
    FROM ap_risk_cases
    WHERE student_db_id IN (${placeholders})
      AND status IN ('open', 'monitoring', 'escalated')
    ORDER BY opened_at DESC
    `,
    studentIds,
  );
  for (const row of rows) {
    const sid = Number(row.student_db_id);
    if (map.has(sid)) continue;
    map.set(sid, {
      id: Number(row.id),
      status: row.status,
      severity: row.severity,
      openedAt: String(row.opened_at),
      escalated: row.status === "escalated",
    });
  }
  return map;
}

function mapStudentRow(
  row: Awaited<ReturnType<typeof listStudents>>["data"][number],
  mentor: MentoringStudentRow["mentor"],
  activeCase: MentoringStudentRow["activeCase"],
): MentoringStudentRow {
  const risk = row.risk as "High" | "Medium" | "Low";
  return {
    id: row.id,
    name: row.name,
    rollNo: row.rollNo,
    admissionNo: row.admissionNo,
    college: row.college,
    course: row.course,
    branch: row.branch,
    year: row.year ?? null,
    semester: row.semester ?? null,
    section: row.section,
    attendance: row.attendance,
    risk,
    riskReason: riskReasonFromLevel(risk),
    mentor,
    activeCase,
  };
}

export async function getMentoringDashboard(
  authz: AuthzContext,
  filters: MentoringListFilters,
) {
  if (!hasPermission(authz, "mentoring.view")) fail(403, "Forbidden");

  const listFilters: StudentListFilters = { ...filters };
  const restrictMentees = shouldRestrictToOwnMentees(authz);
  let mentorStaffLinkId = filters.mentorStaffLinkId;

  if (restrictMentees) {
    const ownStaffLinkId = await resolveStaffLinkId(authz.userId);
    if (!ownStaffLinkId) {
      return {
        summary: {
          totalMentees: 0,
          highRisk: 0,
          mediumRisk: 0,
          openCases: 0,
          followUpsDue: 0,
          escalated: 0,
        },
        data: [] as MentoringStudentRow[],
        total: 0,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      };
    }
    mentorStaffLinkId = ownStaffLinkId;
  }

  const scanLimit = Math.min(1000, Math.max(filters.limit ?? 100, 100));
  const result = await listStudents({ ...listFilters, limit: scanLimit, offset: filters.offset ?? 0 });

  const studentIds = result.data.map((r) => Number(r.id));
  const [mentors, cases] = await Promise.all([
    loadActiveMentorsByStudent(studentIds),
    loadActiveCasesByStudent(studentIds),
  ]);

  let rows = result.data.map((row) => {
    const sid = Number(row.id);
    return mapStudentRow(row, mentors.get(sid) ?? null, cases.get(sid) ?? null);
  });

  if (mentorStaffLinkId != null) {
    rows = rows.filter((row) => row.mentor?.staffLinkId === mentorStaffLinkId);
  }

  if (filters.onlyAtRisk !== false) {
    rows = rows.filter((row) => row.risk === "High" || row.risk === "Medium");
  }

  if (filters.risk && filters.risk !== "all") {
    rows = rows.filter((row) => row.risk === filters.risk);
  }

  if (filters.caseStatus && filters.caseStatus !== "all") {
    if (filters.caseStatus === "none") {
      rows = rows.filter((row) => !row.activeCase);
    } else {
      rows = rows.filter((row) => row.activeCase?.status === filters.caseStatus);
    }
  }

  const summary = await getMentoringSummary(authz, filters, mentorStaffLinkId);

  return {
    summary,
    data: rows,
    total: rows.length < result.data.length ? rows.length : result.total,
    limit: result.limit,
    offset: result.offset,
    truncated: result.data.length >= scanLimit && result.total > scanLimit,
  };
}

async function getMentoringSummary(
  authz: AuthzContext,
  filters: MentoringListFilters,
  mentorStaffLinkId?: number,
) {
  const scan = await listStudents({
    ...filters,
    limit: 1000,
    offset: 0,
  });
  const studentIds = scan.data.map((r) => Number(r.id));
  const [mentors, cases] = await Promise.all([
    loadActiveMentorsByStudent(studentIds),
    loadActiveCasesByStudent(studentIds),
  ]);

  let rows = scan.data.map((row) => {
    const sid = Number(row.id);
    return mapStudentRow(row, mentors.get(sid) ?? null, cases.get(sid) ?? null);
  });

  if (mentorStaffLinkId != null) {
    rows = rows.filter((row) => row.mentor?.staffLinkId === mentorStaffLinkId);
  }

  const mentees = rows.filter((row) => row.mentor != null);
  const atRisk = rows.filter((row) => row.risk === "High" || row.risk === "Medium");

  const followUpRows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(DISTINCT i.risk_case_id) AS c
    FROM ap_interventions i
    INNER JOIN ap_risk_cases rc ON rc.id = i.risk_case_id
    WHERE i.follow_up_date IS NOT NULL
      AND i.follow_up_date <= CURDATE()
      AND rc.status IN ('open', 'monitoring', 'escalated')
    `,
  );

  return {
    totalMentees: mentees.length,
    highRisk: atRisk.filter((r) => r.risk === "High").length,
    mediumRisk: atRisk.filter((r) => r.risk === "Medium").length,
    openCases: rows.filter((r) => r.activeCase != null).length,
    followUpsDue: Number(followUpRows[0]?.c ?? 0),
    escalated: rows.filter((r) => r.activeCase?.status === "escalated").length,
  };
}

export async function searchMentoringStaff(
  authz: AuthzContext,
  search: string,
  limit = 40,
) {
  if (!hasPermission(authz, "mentoring.assign")) fail(403, "Forbidden");
  const q = search.trim().toLowerCase();
  const capped = Math.min(Math.max(limit, 1), 100);
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      display_name: string | null;
      hrms_employee_id: string;
      department_name: string | null;
      employee_code: string | null;
    })[]
  >(
    `
    SELECT id, display_name, hrms_employee_id, department_name, employee_code
    FROM ap_staff_link
    WHERE (? = '' OR LOWER(display_name) LIKE ? OR LOWER(hrms_employee_id) LIKE ? OR LOWER(COALESCE(employee_code, '')) LIKE ?)
    ORDER BY display_name ASC
    LIMIT ?
    `,
    [q, `%${q}%`, `%${q}%`, `%${q}%`, capped],
  );
  return rows.map((row) => ({
    staffLinkId: Number(row.id),
    name: row.display_name ?? row.hrms_employee_id,
    hrmsEmployeeId: row.hrms_employee_id,
    department: row.department_name,
    employeeCode: row.employee_code,
  }));
}

export async function assignMentor(
  authz: AuthzContext,
  input: {
    studentDbId: number;
    facultyStaffLinkId: number;
    academicYearLabel?: string;
    notes?: string;
    ipAddress?: string | null;
  },
) {
  if (!hasPermission(authz, "mentoring.assign")) fail(403, "Forbidden");
  await assertStudentAccess(authz, String(input.studentDbId));

  const staffRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_staff_link WHERE id = ? LIMIT 1`,
    [input.facultyStaffLinkId],
  );
  if (!staffRows[0]) fail(400, "Mentor staff record not found");

  const academicYear = input.academicYearLabel ?? currentAcademicYearLabel();

  const existing = await queryAcademic<
    (RowDataPacket & { id: number; faculty_staff_link_id: number })[]
  >(
    `
    SELECT id, faculty_staff_link_id
    FROM ap_mentor_assignments
    WHERE student_db_id = ? AND academic_year_label = ? AND is_active = 1
    LIMIT 1
    `,
    [input.studentDbId, academicYear],
  );

  if (existing[0] && Number(existing[0].faculty_staff_link_id) === input.facultyStaffLinkId) {
    fail(409, "This mentor is already assigned to the student");
  }

  const reactivateRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `
    SELECT id FROM ap_mentor_assignments
    WHERE student_db_id = ? AND academic_year_label = ? AND faculty_staff_link_id = ? AND is_active = 0
    LIMIT 1
    `,
    [input.studentDbId, academicYear, input.facultyStaffLinkId],
  );

  return withAcademicTransaction(async (conn) => {
    if (existing[0]) {
      await conn.execute(
        `UPDATE ap_mentor_assignments SET is_active = 0, deactivated_at = NOW() WHERE id = ?`,
        [existing[0].id],
      );
      await writeAuditLog({
        actorUserId: authz.userId,
        action: "mentoring.mentor_changed",
        entityType: "ap_mentor_assignments",
        entityId: Number(existing[0].id),
        oldValue: { facultyStaffLinkId: Number(existing[0].faculty_staff_link_id) },
        newValue: { facultyStaffLinkId: input.facultyStaffLinkId, deactivated: true },
        ipAddress: input.ipAddress,
      });
    }

    if (reactivateRows[0]) {
      await conn.execute(
        `
        UPDATE ap_mentor_assignments
        SET is_active = 1, deactivated_at = NULL, assigned_by = ?, notes = ?, updated_at = NOW()
        WHERE id = ?
        `,
        [authz.userId, input.notes ?? null, reactivateRows[0].id],
      );
      const assignmentId = Number(reactivateRows[0].id);
      await writeAuditLog({
        actorUserId: authz.userId,
        action: existing[0] ? "mentoring.mentor_changed" : "mentoring.mentor_assigned",
        entityType: "ap_mentor_assignments",
        entityId: assignmentId,
        newValue: {
          studentDbId: input.studentDbId,
          facultyStaffLinkId: input.facultyStaffLinkId,
          academicYearLabel: academicYear,
          reactivated: true,
        },
        ipAddress: input.ipAddress,
      });
      return { assignmentId, academicYearLabel: academicYear };
    }

    const [insertResult] = await conn.execute(
      `
      INSERT INTO ap_mentor_assignments
        (student_db_id, faculty_staff_link_id, assigned_by, academic_year_label, is_active, notes)
      VALUES (?, ?, ?, ?, 1, ?)
      `,
      [
        input.studentDbId,
        input.facultyStaffLinkId,
        authz.userId,
        academicYear,
        input.notes ?? null,
      ],
    );
    const assignmentId = Number((insertResult as { insertId: number }).insertId);

    await writeAuditLog({
      actorUserId: authz.userId,
      action: existing[0] ? "mentoring.mentor_changed" : "mentoring.mentor_assigned",
      entityType: "ap_mentor_assignments",
      entityId: assignmentId,
      newValue: {
        studentDbId: input.studentDbId,
        facultyStaffLinkId: input.facultyStaffLinkId,
        academicYearLabel: academicYear,
      },
      ipAddress: input.ipAddress,
    });

    return { assignmentId, academicYearLabel: academicYear };
  });
}

export async function deactivateMentorAssignment(
  authz: AuthzContext,
  assignmentId: number,
  ipAddress?: string | null,
) {
  if (!hasPermission(authz, "mentoring.assign")) fail(403, "Forbidden");

  const rows = await queryAcademic<
    (RowDataPacket & { id: number; student_db_id: number; faculty_staff_link_id: number; is_active: number })[]
  >(
    `SELECT id, student_db_id, faculty_staff_link_id, is_active FROM ap_mentor_assignments WHERE id = ? LIMIT 1`,
    [assignmentId],
  );
  const row = rows[0];
  if (!row) fail(404, "Assignment not found");
  await assertStudentAccess(authz, String(row.student_db_id));
  if (!row.is_active) fail(400, "Assignment is already inactive");

  await executeAcademic(
    `UPDATE ap_mentor_assignments SET is_active = 0, deactivated_at = NOW() WHERE id = ?`,
    [assignmentId],
  );

  await writeAuditLog({
    actorUserId: authz.userId,
    action: "mentoring.mentor_removed",
    entityType: "ap_mentor_assignments",
    entityId: assignmentId,
    oldValue: {
      studentDbId: Number(row.student_db_id),
      facultyStaffLinkId: Number(row.faculty_staff_link_id),
    },
    ipAddress,
  });
}

export async function listMentorAssignments(
  authz: AuthzContext,
  filters: { facultyStaffLinkId?: number; studentDbId?: number },
) {
  if (!hasPermission(authz, "mentoring.view")) fail(403, "Forbidden");

  const where: string[] = ["ma.is_active = 1"];
  const params: unknown[] = [];

  if (filters.facultyStaffLinkId != null) {
    where.push("ma.faculty_staff_link_id = ?");
    params.push(filters.facultyStaffLinkId);
  }
  if (filters.studentDbId != null) {
    where.push("ma.student_db_id = ?");
    params.push(filters.studentDbId);
    await assertStudentAccess(authz, String(filters.studentDbId));
  } else if (shouldRestrictToOwnMentees(authz)) {
    const staffLinkId = await resolveStaffLinkId(authz.userId);
    if (!staffLinkId) return [];
    where.push("ma.faculty_staff_link_id = ?");
    params.push(staffLinkId);
  }

  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      student_db_id: number;
      faculty_staff_link_id: number;
      academic_year_label: string;
      mentor_name: string | null;
      created_at: string;
    })[]
  >(
    `
    SELECT ma.id, ma.student_db_id, ma.faculty_staff_link_id, ma.academic_year_label,
           sl.display_name AS mentor_name, ma.created_at
    FROM ap_mentor_assignments ma
    INNER JOIN ap_staff_link sl ON sl.id = ma.faculty_staff_link_id
    WHERE ${where.join(" AND ")}
    ORDER BY ma.created_at DESC
  `,
    params,
  );

  const results = [];
  for (const row of rows) {
    const scope = await getStudentScope(String(row.student_db_id));
    if (!scope) continue;
    try {
      assertEntityInScope(authz, scope);
    } catch {
      continue;
    }
    results.push({
      assignmentId: Number(row.id),
      studentDbId: Number(row.student_db_id),
      facultyStaffLinkId: Number(row.faculty_staff_link_id),
      mentorName: row.mentor_name ?? "Staff",
      academicYearLabel: row.academic_year_label,
      createdAt: String(row.created_at),
    });
  }
  return results;
}

async function recordCaseEvent(
  riskCaseId: number,
  eventType: string,
  actorUserId: number,
  oldStatus: string | null,
  newStatus: string | null,
  notes?: string | null,
) {
  await executeAcademic(
    `
    INSERT INTO ap_risk_case_events (risk_case_id, event_type, old_status, new_status, actor_user_id, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [riskCaseId, eventType, oldStatus, newStatus, actorUserId, notes ?? null],
  );
}

export async function createRiskCase(
  authz: AuthzContext,
  input: {
    studentDbId: number;
    riskType?: string;
    notes?: string;
    ipAddress?: string | null;
  },
) {
  if (!hasPermission(authz, "mentoring.case_manage")) fail(403, "Forbidden");
  await assertStudentAccess(authz, String(input.studentDbId));

  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `
    SELECT id FROM ap_risk_cases
    WHERE student_db_id = ? AND status IN ('open', 'monitoring', 'escalated')
    LIMIT 1
    `,
    [input.studentDbId],
  );
  if (existing[0]) fail(409, "An active complaint already exists for this student");

  const attendance = await getStudentAttendance(String(input.studentDbId));
  const risk = attendance?.risk ?? "Low";
  const severity = severityFromRisk(risk);
  const riskReason = riskReasonFromLevel(risk);
  const academicYear = currentAcademicYearLabel();

  const mentorRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `
    SELECT id FROM ap_mentor_assignments
    WHERE student_db_id = ? AND is_active = 1
    ORDER BY created_at DESC LIMIT 1
    `,
    [input.studentDbId],
  );

  const result = await executeAcademic(
    `
    INSERT INTO ap_risk_cases
      (student_db_id, risk_type, risk_reason, severity, status, opened_at, opened_by,
       assigned_mentor_id, academic_year_label)
    VALUES (?, ?, ?, ?, 'open', NOW(), ?, ?, ?)
    `,
    [
      input.studentDbId,
      input.riskType ?? "attendance",
      riskReason,
      severity,
      authz.userId,
      mentorRows[0]?.id ?? null,
      academicYear,
    ],
  );
  const caseId = Number((result as { insertId: number }).insertId);

  await recordCaseEvent(caseId, "created", authz.userId, null, "open", input.notes);
  await writeAuditLog({
    actorUserId: authz.userId,
    action: "mentoring.case_created",
    entityType: "ap_risk_cases",
    entityId: caseId,
    newValue: { studentDbId: input.studentDbId, severity, riskReason },
    ipAddress: input.ipAddress,
  });

  return { caseId, status: "open" as const, severity, riskReason };
}

export async function updateRiskCaseStatus(
  authz: AuthzContext,
  caseId: number,
  status: RiskCaseStatus,
  notes?: string,
  ipAddress?: string | null,
) {
  if (status === "escalated") {
    if (!hasPermission(authz, "mentoring.escalate")) fail(403, "Forbidden");
  } else if (!hasPermission(authz, "mentoring.case_manage")) {
    fail(403, "Forbidden");
  }

  const rows = await queryAcademic<
    (RowDataPacket & { id: number; student_db_id: number; status: RiskCaseStatus })[]
  >(`SELECT id, student_db_id, status FROM ap_risk_cases WHERE id = ? LIMIT 1`, [caseId]);
  const row = rows[0];
  if (!row) fail(404, "Complaint not found");
  await assertStudentAccess(authz, String(row.student_db_id));

  const oldStatus = row.status;
  if (oldStatus === status) return { caseId, status };

  const updates: string[] = ["status = ?", "updated_at = NOW()"];
  const params: unknown[] = [status];
  if (status === "escalated") {
    updates.push("escalated_at = NOW()");
  }
  if (status === "resolved") {
    updates.push("resolved_at = NOW()", "closed_at = NOW()");
  }
  params.push(caseId);

  await executeAcademic(`UPDATE ap_risk_cases SET ${updates.join(", ")} WHERE id = ?`, params);
  await recordCaseEvent(caseId, "status_changed", authz.userId, oldStatus, status, notes);

  const auditAction =
    status === "escalated"
      ? "mentoring.case_escalated"
      : status === "resolved"
        ? "mentoring.case_resolved"
        : "mentoring.case_status_changed";

  await writeAuditLog({
    actorUserId: authz.userId,
    action: auditAction,
    entityType: "ap_risk_cases",
    entityId: caseId,
    oldValue: { status: oldStatus },
    newValue: { status, notes },
    ipAddress,
  });

  return { caseId, status };
}

export async function addIntervention(
  authz: AuthzContext,
  caseId: number,
  input: {
    actionType: InterventionType;
    notes?: string;
    outcome?: string;
    followUpDate?: string | null;
    actionAt?: string;
    ipAddress?: string | null;
  },
) {
  if (!hasPermission(authz, "mentoring.intervene")) fail(403, "Forbidden");

  const rows = await queryAcademic<
    (RowDataPacket & { id: number; student_db_id: number; status: RiskCaseStatus })[]
  >(`SELECT id, student_db_id, status FROM ap_risk_cases WHERE id = ? LIMIT 1`, [caseId]);
  const row = rows[0];
  if (!row) fail(404, "Complaint not found");
  await assertStudentAccess(authz, String(row.student_db_id));
  if (row.status === "resolved") fail(400, "Cannot add interventions to a resolved complaint");

  if (!INTERVENTION_TYPES.includes(input.actionType)) {
    fail(400, "Invalid intervention type");
  }

  const result = await executeAcademic(
    `
    INSERT INTO ap_interventions
      (risk_case_id, action_type, notes, outcome, follow_up_date, action_by, action_at)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
    `,
    [
      caseId,
      input.actionType,
      input.notes ?? null,
      input.outcome ?? null,
      input.followUpDate ?? null,
      authz.userId,
      input.actionAt ?? null,
    ],
  );
  const interventionId = Number((result as { insertId: number }).insertId);

  await writeAuditLog({
    actorUserId: authz.userId,
    action: "mentoring.intervention_added",
    entityType: "ap_interventions",
    entityId: interventionId,
    newValue: { caseId, actionType: input.actionType },
    ipAddress: input.ipAddress,
  });

  return { interventionId };
}

export async function getSubjectAttendance(
  studentDbId: string,
  startBound: string | null,
  endBound: string | null,
) {
  const rows = await queryAcademic<
    (RowDataPacket & {
      subject_code: string | null;
      subject_name: string | null;
      attendance_pct: number | null;
      present: number;
      absent: number;
    })[]
  >(
    `
    SELECT
      cs.subject_code,
      cs.subject_name,
      ROUND(
        SUM(CASE WHEN aps.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN aps.status IN ('present','absent') THEN 1 ELSE 0 END), 0),
        1
      ) AS attendance_pct,
      SUM(CASE WHEN aps.status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN aps.status = 'absent' THEN 1 ELSE 0 END) AS absent
    FROM ap_attendance_post_students aps
    INNER JOIN ap_attendance_posts ap ON ap.id = aps.attendance_post_id
    INNER JOIN ap_class_sessions cs ON cs.id = ap.class_session_id
    WHERE aps.student_db_id = ?
      AND cs.session_date >= COALESCE(?, DATE_SUB(CURDATE(), INTERVAL 90 DAY))
      AND cs.session_date <= COALESCE(?, CURDATE())
    GROUP BY cs.subject_id, cs.subject_code, cs.subject_name
    HAVING SUM(CASE WHEN aps.status IN ('present','absent') THEN 1 ELSE 0 END) > 0
    ORDER BY attendance_pct ASC
    `,
    [studentDbId, startBound, endBound],
  );

  return rows.map((row) => ({
    subjectCode: row.subject_code,
    subjectName: row.subject_name ?? row.subject_code ?? "Subject",
    attendance: Number(row.attendance_pct ?? 0),
    present: Number(row.present ?? 0),
    absent: Number(row.absent ?? 0),
    risk: riskFromAttendance(Number(row.attendance_pct ?? 0)),
  }));
}

export async function getMentoringStudentDetail(authz: AuthzContext, studentId: string) {
  if (!hasPermission(authz, "mentoring.view")) fail(403, "Forbidden");
  await assertStudentAccess(authz, studentId);

  const [student, attendance, mentorRows, caseRows, assignmentHistory] = await Promise.all([
    getStudentById(studentId),
    getStudentAttendance(studentId),
    queryAcademic<
      (RowDataPacket & {
        id: number;
        faculty_staff_link_id: number;
        display_name: string | null;
        academic_year_label: string;
      })[]
    >(
      `
      SELECT ma.id, ma.faculty_staff_link_id, sl.display_name, ma.academic_year_label
      FROM ap_mentor_assignments ma
      INNER JOIN ap_staff_link sl ON sl.id = ma.faculty_staff_link_id
      WHERE ma.student_db_id = ? AND ma.is_active = 1
      ORDER BY ma.created_at DESC LIMIT 1
      `,
      [studentId],
    ),
    queryAcademic<
      (RowDataPacket & {
        id: number;
        risk_type: string;
        risk_reason: string | null;
        severity: string;
        status: RiskCaseStatus;
        opened_at: string;
        escalated_at: string | null;
        resolved_at: string | null;
        assigned_mentor_id: number | null;
      })[]
    >(
      `
      SELECT id, risk_type, risk_reason, severity, status, opened_at, escalated_at, resolved_at, assigned_mentor_id
      FROM ap_risk_cases
      WHERE student_db_id = ?
      ORDER BY opened_at DESC
      `,
      [studentId],
    ),
    listMentorAssignments(authz, { studentDbId: Number(studentId) }),
  ]);

  if (!student) fail(404, "Student not found");

  const period = attendance?.attendancePeriod;
  const startBound = period?.source === "semester" && period.startDate ? period.startDate : null;
  const endBound =
    period?.source === "semester" && period.attendanceEndDate ? period.attendanceEndDate : null;

  const subjectAttendance = await getSubjectAttendance(studentId, startBound, endBound);

  const activeCase = caseRows.find((c) =>
    ["open", "monitoring", "escalated"].includes(c.status),
  );

  let interventions: Array<{
    id: number;
    actionType: string;
    notes: string | null;
    outcome: string | null;
    followUpDate: string | null;
    actionAt: string;
    actionByName: string | null;
  }> = [];
  let caseEvents: Array<{
    id: number;
    eventType: string;
    oldStatus: string | null;
    newStatus: string | null;
    notes: string | null;
    createdAt: string;
    actorName: string | null;
  }> = [];

  if (activeCase) {
    const [intRows, evtRows] = await Promise.all([
      queryAcademic<
        (RowDataPacket & {
          id: number;
          action_type: string;
          notes: string | null;
          outcome: string | null;
          follow_up_date: string | null;
          action_at: string;
          actor_name: string | null;
        })[]
      >(
        `
        SELECT i.id, i.action_type, i.notes, i.outcome, i.follow_up_date, i.action_at,
               u.name AS actor_name
        FROM ap_interventions i
        LEFT JOIN ap_users u ON u.id = i.action_by
        WHERE i.risk_case_id = ?
        ORDER BY i.action_at DESC, i.id DESC
        `,
        [activeCase.id],
      ),
      queryAcademic<
        (RowDataPacket & {
          id: number;
          event_type: string;
          old_status: string | null;
          new_status: string | null;
          notes: string | null;
          created_at: string;
          actor_name: string | null;
        })[]
      >(
        `
        SELECT e.id, e.event_type, e.old_status, e.new_status, e.notes, e.created_at,
               u.name AS actor_name
        FROM ap_risk_case_events e
        LEFT JOIN ap_users u ON u.id = e.actor_user_id
        WHERE e.risk_case_id = ?
        ORDER BY e.created_at ASC
        `,
        [activeCase.id],
      ),
    ]);

    interventions = intRows.map((row) => ({
      id: Number(row.id),
      actionType: row.action_type,
      notes: row.notes,
      outcome: row.outcome,
      followUpDate: row.follow_up_date ? String(row.follow_up_date) : null,
      actionAt: String(row.action_at),
      actionByName: row.actor_name,
    }));

    caseEvents = evtRows.map((row) => ({
      id: Number(row.id),
      eventType: row.event_type,
      oldStatus: row.old_status,
      newStatus: row.new_status,
      notes: row.notes,
      createdAt: String(row.created_at),
      actorName: row.actor_name,
    }));
  }

  const risk = attendance?.risk ?? riskFromAttendance(student.attendance);

  return {
    student: {
      id: student.id,
      name: student.name,
      rollNo: student.rollNo,
      admissionNo: student.admissionNo,
      college: student.college,
      course: student.course,
      branch: student.branch,
      year: student.year,
      semester: student.semester,
      section: student.section,
      status: student.status,
    },
    attendance: {
      overall: student.attendance,
      present: student.present,
      absent: student.absent,
      workingDays: student.workingDays,
      risk,
      riskReason: riskReasonFromLevel(risk),
      period: student.attendancePeriod ?? null,
      subjects: subjectAttendance,
    },
    mentor: mentorRows[0]
      ? {
          assignmentId: Number(mentorRows[0].id),
          staffLinkId: Number(mentorRows[0].faculty_staff_link_id),
          name: mentorRows[0].display_name ?? "Staff",
          academicYearLabel: mentorRows[0].academic_year_label,
        }
      : null,
    mentorAssignments: assignmentHistory,
    activeCase: activeCase
      ? {
          id: Number(activeCase.id),
          riskType: activeCase.risk_type,
          riskReason: activeCase.risk_reason,
          severity: activeCase.severity,
          status: activeCase.status,
          openedAt: String(activeCase.opened_at),
          escalatedAt: activeCase.escalated_at ? String(activeCase.escalated_at) : null,
          resolvedAt: activeCase.resolved_at ? String(activeCase.resolved_at) : null,
        }
      : null,
    caseHistory: caseRows.map((c) => ({
      id: Number(c.id),
      status: c.status,
      severity: c.severity,
      openedAt: String(c.opened_at),
      resolvedAt: c.resolved_at ? String(c.resolved_at) : null,
    })),
    interventions,
    caseEvents,
    permissions: {
      canAssign: hasPermission(authz, "mentoring.assign"),
      canIntervene: hasPermission(authz, "mentoring.intervene"),
      canManageCase: hasPermission(authz, "mentoring.case_manage"),
      canEscalate: hasPermission(authz, "mentoring.escalate"),
    },
  };
}

export async function getRiskCaseById(authz: AuthzContext, caseId: number) {
  if (!hasPermission(authz, "mentoring.view")) fail(403, "Forbidden");
  const rows = await queryAcademic<
    (RowDataPacket & { student_db_id: number })[]
  >(`SELECT student_db_id FROM ap_risk_cases WHERE id = ? LIMIT 1`, [caseId]);
  if (!rows[0]) fail(404, "Complaint not found");
  return getMentoringStudentDetail(authz, String(rows[0].student_db_id));
}
