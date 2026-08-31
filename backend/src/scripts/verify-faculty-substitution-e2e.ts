/**
 * End-to-end faculty substitution verification using real published timetable data.
 * Requires API server, migrations, and at least one published plan with faculty assignments.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";

const base = `http://127.0.0.1:${env.port}`;

type CandidateRow = RowDataPacket & {
  entry_id: number;
  plan_id: number;
  college_id: number;
  course_id: number;
  branch_id: number;
  batch: string;
  year_of_study: number | null;
  semester_number: number | null;
  section_name: string;
  academic_year_label: string;
  timing_slot_id: number;
  day_of_week: string;
  faculty_staff_link_id: number;
  faculty_name: string;
  requester_user_id: number;
  requester_username: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, setCookie: response.headers.getSetCookie?.() ?? [] };
}

function extractSid(setCookie: string[]) {
  const prefix = `${env.auth.cookieName}=`;
  for (const line of setCookie) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).split(";")[0];
  }
  return null;
}

async function login(identifier: string, password: string) {
  const result = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  assert(result.status === 200, `Login failed for ${identifier}: ${result.status} ${JSON.stringify(result.json)}`);
  const sid = extractSid(result.setCookie);
  assert(sid, "Missing session cookie");
  return `${env.auth.cookieName}=${sid}`;
}

function dayCodeToJsDay(code: string): number {
  const map: Record<string, number> = {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THUR: 4,
    FRI: 5,
    SAT: 6,
  };
  return map[code] ?? 1;
}

function nextDateForDay(dayCode: string, from = new Date()): string {
  const target = dayCodeToJsDay(dayCode);
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    if (d.getDay() === target) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    d.setDate(d.getDate() + 1);
  }
  throw new Error(`Could not find upcoming date for ${dayCode}`);
}

async function findCandidate(): Promise<CandidateRow & { sessionDate: string }> {
  const rows = await queryAcademic<CandidateRow[]>(
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
      COALESCE(e.timing_slot_id, e.period_slot_id) AS timing_slot_id,
      e.day_of_week,
      e.faculty_staff_link_id,
      sl.display_name AS faculty_name,
      u.id AS requester_user_id,
      u.username AS requester_username
    FROM ap_timetable_plans p
    INNER JOIN ap_timetable_entries e ON e.plan_id = p.id
    INNER JOIN ap_staff_link sl ON sl.id = e.faculty_staff_link_id
    INNER JOIN ap_users u ON u.hrms_employee_id = sl.hrms_employee_id
    WHERE p.status = 'published'
      AND e.subject_id IS NOT NULL
      AND e.faculty_staff_link_id IS NOT NULL
      AND u.is_active = 1
    ORDER BY p.updated_at DESC, e.id DESC
    LIMIT 50
    `,
  );
  assert(rows.length > 0, "No published timetable entries with linked faculty users found");
  const row = rows[0]!;
  const sessionDate = nextDateForDay(row.day_of_week);
  return { ...row, sessionDate };
}

async function findFreeReplacement(
  sessionDate: string,
  timingSlotId: number,
  excludeStaffLinkId: number,
  collegeId: number,
  branchId: number,
  cookie: string,
) {
  const result = await req(
    `/api/faculty-substitutions/faculty-availability?sessionDate=${sessionDate}&timingSlotId=${timingSlotId}&collegeId=${collegeId}&branchId=${branchId}&q=`,
    { cookie },
  );
  assert(result.status === 200, `Faculty availability failed: ${result.status}`);
  const data = (result.json as { data: { staffLinkId: number; displayName: string; isAvailable: boolean }[] }).data ?? [];
  const free = data.find((f) => f.isAvailable && f.staffLinkId !== excludeStaffLinkId);
  assert(free, "No available replacement faculty found for candidate slot");
  return free;
}

async function findApproverCookie(stepRoleKey: string | null, collegeId: number, branchId: number) {
  if (!stepRoleKey) return null;
  const users = await queryAcademic<(RowDataPacket & { username: string })[]>(
    `
    SELECT DISTINCT u.username
    FROM ap_users u
    INNER JOIN ap_user_roles ur ON ur.user_id = u.id
    INNER JOIN ap_roles r ON r.id = ur.role_id
    WHERE r.role_key = ?
      AND u.is_active = 1
      AND (ur.college_id IS NULL OR ur.college_id = ?)
      AND (ur.branch_id IS NULL OR ur.branch_id = ?)
    LIMIT 5
    `,
    [stepRoleKey, collegeId, branchId],
  );
  for (const user of users) {
    try {
      return await login(user.username, SUPER_ADMIN_SEED.password);
    } catch {
      // HRMS password — try superadmin fallback for test users only
    }
  }
  return null;
}

async function cleanupRequest(requestId: number) {
  await executeAcademic(`DELETE FROM ap_class_session_substitutions WHERE request_id = ?`, [requestId]).catch(
    () => undefined,
  );
  await executeAcademic(`DELETE FROM ap_faculty_substitution_details WHERE request_id = ?`, [requestId]).catch(
    () => undefined,
  );
  await executeAcademic(`DELETE FROM ap_request_actions WHERE request_id = ?`, [requestId]).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_requests WHERE id = ?`, [requestId]).catch(() => undefined);
}

async function main() {
  console.log("=== Faculty substitution E2E verification ===\n");

  const candidate = await findCandidate();
  console.log(
    `Candidate: ${candidate.section_name} on ${candidate.sessionDate}, faculty ${candidate.faculty_name} (${candidate.requester_username})`,
  );

  let requesterCookie: string;
  try {
    requesterCookie = await login(candidate.requester_username, SUPER_ADMIN_SEED.password);
  } catch {
    requesterCookie = await login(SUPER_ADMIN_SEED.username, SUPER_ADMIN_SEED.password);
    console.log("Note: using superadmin as requester (faculty HRMS login unavailable in script)");
  }

  const resolve = await req("/api/faculty-substitutions/resolve-class", {
    method: "POST",
    cookie: requesterCookie,
    body: JSON.stringify({
      sessionDate: candidate.sessionDate,
      collegeId: candidate.college_id,
      courseId: candidate.course_id,
      branchId: candidate.branch_id,
      batch: candidate.batch,
      yearOfStudy: candidate.year_of_study,
      semesterNumber: candidate.semester_number,
      sectionName: candidate.section_name,
      timingSlotId: candidate.timing_slot_id,
      academicYear: candidate.academic_year_label,
    }),
  });
  assert(resolve.status === 200, `Resolve class failed: ${resolve.status} ${JSON.stringify(resolve.json)}`);
  const resolved = (resolve.json as { data: { timetableEntryId: number; facultyStaffLinkId: number } }).data;
  assert(
    Number(resolved.facultyStaffLinkId) === Number(candidate.faculty_staff_link_id),
    "Resolved faculty must match timetable entry",
  );
  console.log("1. Class resolved with correct original faculty");

  const replacement = await findFreeReplacement(
    candidate.sessionDate,
    candidate.timing_slot_id,
    candidate.faculty_staff_link_id,
    candidate.college_id,
    candidate.branch_id,
    requesterCookie,
  );
  console.log(`2. Replacement faculty: ${replacement.displayName} (available)`);

  const create = await req("/api/requests", {
    method: "POST",
    cookie: requesterCookie,
    body: JSON.stringify({
      typeKey: "faculty_substitution",
      collegeId: candidate.college_id,
      branchId: candidate.branch_id,
      substitution: {
        sessionDate: candidate.sessionDate,
        timetableEntryId: resolved.timetableEntryId,
        replacementFacultyStaffLinkId: replacement.staffLinkId,
        reason: "E2E verification — faculty unavailable",
        collegeId: candidate.college_id,
        courseId: candidate.course_id,
        branchId: candidate.branch_id,
        batch: candidate.batch,
        yearOfStudy: candidate.year_of_study,
        semesterNumber: candidate.semester_number,
        sectionName: candidate.section_name,
        timingSlotId: candidate.timing_slot_id,
        academicYear: candidate.academic_year_label,
      },
    }),
  });
  assert(create.status === 201, `Create failed: ${create.status} ${JSON.stringify(create.json)}`);
  const requestId = Number((create.json as { request: { id: number } }).request.id);
  console.log(`3. Request created: #${requestId}`);

  const mine = await req("/api/requests?filter=mine", { cookie: requesterCookie });
  const mineIds = ((mine.json as { data: { id: number }[] }).data ?? []).map((r) => r.id);
  assert(mineIds.includes(requestId), "Request must appear in My Requests");
  console.log("4. Visible in My Requests");

  const submit = await req(`/api/requests/${requestId}/submit`, {
    method: "POST",
    cookie: requesterCookie,
    body: "{}",
  });
  assert(submit.status === 200, `Submit failed: ${submit.status}`);
  const afterSubmit = submit.json as {
    request: { status: string };
    currentStep: { stepKey: string; approverRoleKey: string | null } | null;
    workflowSteps: { stepKey: string; isFinal: boolean }[];
  };
  assert(afterSubmit.request.status === "pending_approval", "Must be pending after submit");
  console.log(`5. Submitted — current step: ${afterSubmit.currentStep?.stepKey ?? "none"}`);

  const entryBefore = await queryAcademic<(RowDataPacket & { faculty_staff_link_id: number })[]>(
    `SELECT faculty_staff_link_id FROM ap_timetable_entries WHERE id = ? LIMIT 1`,
    [candidate.entry_id],
  );
  const permanentFacultyBefore = Number(entryBefore[0]?.faculty_staff_link_id);

  let detail = afterSubmit;
  let stepIndex = 0;
  while (detail.request.status === "pending_approval" && detail.currentStep) {
    stepIndex += 1;
    const roleKey = detail.currentStep.approverRoleKey;
    let approverCookie = await findApproverCookie(roleKey, candidate.college_id, candidate.branch_id);
    if (!approverCookie) {
      approverCookie = await login(SUPER_ADMIN_SEED.username, SUPER_ADMIN_SEED.password);
    }
    const pending = await req("/api/requests/pending", { cookie: approverCookie });
    const pendingIds = ((pending.json as { data: { id: number }[] }).data ?? []).map((r) => r.id);
    assert(pendingIds.includes(requestId), `Step ${stepIndex}: approver must see request on pending`);
    const approve = await req(`/api/requests/${requestId}/approve`, {
      method: "POST",
      cookie: approverCookie,
      body: JSON.stringify({ comment: `E2E approve step ${stepIndex}` }),
    });
    assert(approve.status === 200, `Approve step ${stepIndex} failed: ${approve.status} ${JSON.stringify(approve.json)}`);
    detail = approve.json as typeof afterSubmit;
    console.log(`6.${stepIndex} Approved step ${detail.currentStep?.stepKey ?? "final"}`);
    if (stepIndex > 10) throw new Error("Too many workflow steps");
  }

  assert(detail.request.status === "approved", `Expected approved, got ${detail.request.status}`);
  console.log("7. Final approval reached");

  const entryAfter = await queryAcademic<(RowDataPacket & { faculty_staff_link_id: number })[]>(
    `SELECT faculty_staff_link_id FROM ap_timetable_entries WHERE id = ? LIMIT 1`,
    [candidate.entry_id],
  );
  assert(
    Number(entryAfter[0]?.faculty_staff_link_id) === permanentFacultyBefore,
    "Permanent timetable entry faculty must be unchanged",
  );
  console.log("8. Permanent weekly timetable unchanged");

  const subRows = await queryAcademic<(RowDataPacket & { execution_status: string; class_session_id: number | null })[]>(
  `
    SELECT execution_status, class_session_id
    FROM ap_faculty_substitution_details
    WHERE request_id = ?
    LIMIT 1
  `,
    [requestId],
  );
  assert(subRows[0]?.execution_status === "applied", `Substitution not applied: ${subRows[0]?.execution_status}`);
  const classSessionId = Number(subRows[0]?.class_session_id);
  assert(classSessionId > 0, "Class session must be linked after apply");
  console.log("9. Date-specific substitution applied");

  const sessionRow = await queryAcademic<(RowDataPacket & { faculty_staff_link_id: number })[]>(
    `SELECT faculty_staff_link_id FROM ap_class_sessions WHERE id = ? LIMIT 1`,
    [classSessionId],
  );
  assert(
    Number(sessionRow[0]?.faculty_staff_link_id) === replacement.staffLinkId,
    "Class session faculty must be replacement faculty",
  );
  console.log("10. Class session uses replacement faculty");

  const auditRows = await queryAcademic<(RowDataPacket & { action: string })[]>(
    `
    SELECT action
    FROM ap_audit_logs
    WHERE entity_type = 'request' AND entity_id = ?
      AND action LIKE 'faculty.substitution.%'
    ORDER BY id ASC
    `,
    [requestId],
  );
  const actions = auditRows.map((r) => r.action);
  assert(actions.includes("faculty.substitution.applied"), "Must have faculty.substitution.applied audit");
  console.log(`11. Audit actions: ${actions.join(", ")}`);

  const overrideRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_class_session_substitutions WHERE request_id = ? LIMIT 1`,
    [requestId],
  );
  assert(overrideRows[0], "Override record must exist");
  console.log("12. Override record created");

  console.log("\nFaculty substitution E2E verification passed.");
  console.log(`Request #${requestId} left in approved/applied state for manual UI inspection.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
