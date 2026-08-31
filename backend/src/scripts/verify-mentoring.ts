/**
 * Mentoring & Risk Management verification.
 * Requires API server running and mentoring migration + RBAC applied.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { executeAcademic, queryAcademic, queryStudent } from "../db/pools.js";

const base = `http://127.0.0.1:${env.port}`;
const COLLEGE_A = 1;
const BRANCH_A = 1;
const BRANCH_B = 2;
const password = "MentoringTest!234";

const hodUser = "mentor_hod_tmp";
const facultyUser = "mentor_faculty_tmp";
const facultyOutsider = "mentor_faculty_out_tmp";

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

async function login(username: string) {
  const result = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: username, password }),
  });
  assert(result.status === 200, `Login failed for ${username}: ${result.status}`);
  const sid = extractSid(result.setCookie);
  assert(sid, "Missing session cookie");
  return `${env.auth.cookieName}=${sid}`;
}

async function ensureRoleId(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  assert(rows[0]?.id, `Role ${roleKey} missing`);
  return Number(rows[0].id);
}

async function ensureRolePermission(roleKey: string, permissionKey: string) {
  const roleId = await ensureRoleId(roleKey);
  const permRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_permissions WHERE permission_key = ? LIMIT 1`,
    [permissionKey],
  );
  assert(permRows[0]?.id, `Permission ${permissionKey} missing — run db:migrate:rbac`);
  const permissionId = Number(permRows[0].id);
  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_role_permissions WHERE role_id = ? AND permission_id = ? LIMIT 1`,
    [roleId, permissionId],
  );
  if (!existing[0]) {
    await executeAcademic(
      `INSERT INTO ap_role_permissions (role_id, permission_id) VALUES (?, ?)`,
      [roleId, permissionId],
    );
  }
}

async function deleteUser(username: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = ? LIMIT 1`,
    [username],
  );
  const id = rows[0]?.id;
  if (!id) return;
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [id]);
}

async function createUser(username: string, roleKey: string, collegeId: number, branchId: number | null) {
  await deleteUser(username);
  const hash = await bcrypt.hash(password, 10);
  const inserted = await executeAcademic(
    `INSERT INTO ap_users (name, email, username, password_hash, is_active) VALUES (?, ?, ?, ?, 1)`,
    [`Test ${roleKey}`, `${username}@test.local`, username, hash],
  );
  const userId = Number(inserted.insertId);
  const roleId = await ensureRoleId(roleKey);
  await executeAcademic(
    `INSERT INTO ap_user_roles (user_id, role_id, college_id, branch_id) VALUES (?, ?, ?, ?)`,
    [userId, roleId, collegeId, branchId],
  );
  return userId;
}

async function ensureMentoringPermissions() {
  const keys = [
    "mentoring.view",
    "mentoring.manage",
    "mentoring.assign",
    "mentoring.intervene",
    "mentoring.case_manage",
    "mentoring.escalate",
  ];
  for (const key of keys) {
    await ensureRolePermission("hod", key);
  }
  await ensureRolePermission("faculty", "mentoring.view");
  await ensureRolePermission("faculty", "mentoring.intervene");
}

async function findStudentForTests() {
  const rows = await queryStudent<
    (RowDataPacket & { id: number; college_id: number | null; branch_id: number | null })[]
  >(
    `
    SELECT s.id, s.college_id, s.branch_id
    FROM students s
    WHERE s.college_id IS NOT NULL AND s.branch_id IS NOT NULL
    LIMIT 1
    `,
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    collegeId: Number(rows[0].college_id),
    branchId: Number(rows[0].branch_id),
  };
}

async function findOtherBranchId(collegeId: number, branchId: number) {
  const rows = await queryStudent<(RowDataPacket & { branch_id: number })[]>(
    `
    SELECT DISTINCT s.branch_id
    FROM students s
    WHERE s.college_id = ? AND s.branch_id IS NOT NULL AND s.branch_id <> ?
    LIMIT 1
    `,
    [collegeId, branchId],
  );
  if (rows[0]?.branch_id != null) return Number(rows[0].branch_id);
  return branchId + 1000;
}

async function findStaffLink() {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_staff_link ORDER BY id ASC LIMIT 1`,
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function countAudit(action: string) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM ap_audit_logs WHERE action = ?`,
    [action],
  );
  return Number(rows[0]?.c ?? 0);
}

async function cleanupStudentMentoring(studentId: number) {
  await executeAcademic(
    `DELETE i FROM ap_interventions i
     INNER JOIN ap_risk_cases rc ON rc.id = i.risk_case_id
     WHERE rc.student_db_id = ?`,
    [studentId],
  ).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_risk_case_events WHERE risk_case_id IN (SELECT id FROM ap_risk_cases WHERE student_db_id = ?)`, [studentId]).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_risk_cases WHERE student_db_id = ?`, [studentId]).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_mentor_assignments WHERE student_db_id = ?`, [studentId]).catch(() => undefined);
}

async function main() {
  console.log("=== Mentoring verification ===\n");
  await ensureMentoringPermissions();

  const health = await req("/api/health");
  assert(health.status === 200, "API health check failed — start the server first");

  const unauth = await req("/api/mentoring/dashboard");
  assert(unauth.status === 401, `Expected 401 for unauthenticated dashboard, got ${unauth.status}`);
  console.log("1. Unauthenticated access denied OK");

  const student = await findStudentForTests();
  assert(student, "No student with college/branch found for tests");
  const studentId = student.id;
  const scopeCollegeId = student.collegeId;
  const scopeBranchId = student.branchId;
  const otherBranchId = await findOtherBranchId(scopeCollegeId, scopeBranchId);

  await createUser(hodUser, "hod", scopeCollegeId, scopeBranchId);
  await createUser(facultyUser, "faculty", scopeCollegeId, scopeBranchId);
  await createUser(facultyOutsider, "faculty", scopeCollegeId, otherBranchId);

  const hodCookieScoped = await login(hodUser);
  const facultyCookieScoped = await login(facultyUser);
  const outsiderCookieScoped = await login(facultyOutsider);

  const dashboard = await req("/api/mentoring/dashboard", { cookie: hodCookieScoped });
  assert(dashboard.status === 200, `HOD dashboard failed: ${dashboard.status}`);
  console.log("2. HOD dashboard OK");
  await cleanupStudentMentoring(studentId);

  const staffLinkId = await findStaffLink();
  assert(staffLinkId, "No ap_staff_link row found for mentor assignment test");

  const beforeAssignAudit = await countAudit("mentoring.mentor_assigned");
  const assign = await req("/api/mentoring/assignments", {
    method: "POST",
    cookie: hodCookieScoped,
    body: JSON.stringify({ studentDbId: studentId, facultyStaffLinkId: staffLinkId }),
  });
  assert(assign.status === 201, `Assign mentor expected 201, got ${assign.status}`);

  const duplicate = await req("/api/mentoring/assignments", {
    method: "POST",
    cookie: hodCookieScoped,
    body: JSON.stringify({ studentDbId: studentId, facultyStaffLinkId: staffLinkId }),
  });
  assert(duplicate.status === 409, `Duplicate assignment should 409, got ${duplicate.status}`);
  console.log("3. Mentor assignment + duplicate prevention OK");

  const afterAssignAudit = await countAudit("mentoring.mentor_assigned");
  assert(afterAssignAudit > beforeAssignAudit, "Audit log for mentor assignment missing");

  const outsiderDetail = await req(`/api/mentoring/students/${studentId}`, { cookie: outsiderCookieScoped });
  assert(
    outsiderDetail.status === 403,
    `Out-of-branch faculty should get 403, got ${outsiderDetail.status}`,
  );
  console.log("4. Student scope isolation OK");

  const beforeCaseAudit = await countAudit("mentoring.case_created");
  const createCase = await req("/api/mentoring/risk-cases", {
    method: "POST",
    cookie: hodCookieScoped,
    body: JSON.stringify({ studentDbId: studentId }),
  });
  assert(createCase.status === 201, `Create case expected 201, got ${createCase.status}`);
  const caseId = Number((createCase.json as { caseId: number }).caseId);
  assert(caseId > 0, "caseId missing");
  console.log("5. Case creation OK");

  const intervention = await req(`/api/mentoring/risk-cases/${caseId}/interventions`, {
    method: "POST",
    cookie: hodCookieScoped,
    body: JSON.stringify({
      actionType: "counselling",
      notes: "Initial counselling session",
      outcome: "Student agreed to improve attendance",
      followUpDate: "2026-09-15",
    }),
  });
  assert(intervention.status === 201, `Intervention failed: ${intervention.status}`);
  console.log("6. Intervention creation OK");

  const escalate = await req(`/api/mentoring/risk-cases/${caseId}/status`, {
    method: "PATCH",
    cookie: hodCookieScoped,
    body: JSON.stringify({ status: "escalated", notes: "Escalated for review" }),
  });
  assert(escalate.status === 200, `Escalate failed: ${escalate.status}`);
  console.log("7. Escalation OK");

  const resolve = await req(`/api/mentoring/risk-cases/${caseId}/status`, {
    method: "PATCH",
    cookie: hodCookieScoped,
    body: JSON.stringify({ status: "resolved" }),
  });
  assert(resolve.status === 200, `Resolve failed: ${resolve.status}`);
  console.log("8. Resolution OK");

  const afterCaseAudit = await countAudit("mentoring.case_created");
  assert(afterCaseAudit > beforeCaseAudit, "Audit log for case creation missing");
  console.log("9. Audit logging OK");

  const detail = await req(`/api/mentoring/students/${studentId}`, { cookie: hodCookieScoped });
  assert(detail.status === 200, `Student detail failed: ${detail.status}`);
  const detailBody = detail.json as { attendance: { risk: string }; permissions: Record<string, boolean> };
  assert(detailBody.attendance?.risk, "Attendance risk missing in detail");
  assert(detailBody.permissions?.canManageCase !== undefined, "Permissions block missing");
  console.log("10. Student detail + risk engine OK");

  const forbidden = await req("/api/mentoring/risk-cases", {
    method: "POST",
    cookie: facultyCookieScoped,
    body: JSON.stringify({ studentDbId: studentId }),
  });
  assert(forbidden.status === 403, `Faculty create case should 403, got ${forbidden.status}`);
  console.log("11. Unauthorized case creation denied OK");

  await deleteUser(hodUser);
  await deleteUser(facultyUser);
  await deleteUser(facultyOutsider);
  await cleanupStudentMentoring(studentId);

  console.log("\nAll mentoring verification checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
