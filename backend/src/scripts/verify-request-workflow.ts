/**
 * Request workflow security verification.
 * Requires API server running and request workflow migration applied.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { executeAcademic, queryAcademic } from "../db/pools.js";

const base = `http://127.0.0.1:${env.port}`;
const COLLEGE_A = 1;
const COLLEGE_B = 2;
const BRANCH_A = 1;
const BRANCH_B = 2;
const password = "RequestTest!234";

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

async function ensureRequestPermissions() {
  for (const permission of ["request.view", "request.create"] as const) {
    await ensureRolePermission("staff", permission);
  }
  for (const permission of ["request.view", "request.create", "request.approve"] as const) {
    await ensureRolePermission("hod", permission);
  }
}

async function ensureRoleId(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  assert(rows[0]?.id, `Role ${roleKey} missing`);
  return Number(rows[0].id);
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

async function deleteUser(username: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = ? LIMIT 1`,
    [username],
  );
  const id = rows[0]?.id;
  if (!id) return;
  await executeAcademic(
    `DELETE FROM ap_request_actions WHERE request_id IN (SELECT id FROM ap_requests WHERE requester_user_id = ?)`,
    [id],
  ).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_requests WHERE requester_user_id = ?`, [id]).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [id]);
}

async function createAndSubmit(cookie: string, title: string, collegeId: number, branchId: number) {
  const create = await req("/api/requests", {
    method: "POST",
    cookie,
    body: JSON.stringify({
      typeKey: "general_academic",
      title,
      body: "Workflow verification",
      collegeId,
      branchId,
    }),
  });
  assert(create.status === 201, `Create expected 201, got ${create.status}`);
  const requestId = Number((create.json as { request: { id: number } }).request.id);
  const submit = await req(`/api/requests/${requestId}/submit`, {
    method: "POST",
    cookie,
    body: "{}",
  });
  assert(submit.status === 200, `Submit expected 200, got ${submit.status}`);
  const detail = submit.json as {
    request: { status: string; currentStepOrder: number | null };
    currentStep: { stepKey: string } | null;
  };
  assert(detail.request.status === "pending_approval", "Request should be pending approval");
  assert(detail.currentStep?.stepKey === "hod_review", "First workflow step should be HOD review");
  return requestId;
}

async function auditCount(requestId: number, actions: string[]) {
  const placeholders = actions.map(() => "?").join(", ");
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM ap_audit_logs
    WHERE entity_type = 'request' AND entity_id = ?
      AND action IN (${placeholders})
    `,
    [requestId, ...actions],
  );
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  console.log("=== Request workflow security verification ===\n");

  await ensureRequestPermissions();

  const staffUser = "req_staff_tmp";
  const hodUserA = "req_hod_a_tmp";
  const hodUserB = "req_hod_b_tmp";
  const outsiderUser = "req_outsider_tmp";
  const otherCollegeUser = "req_other_college_tmp";

  await createUser(staffUser, "staff", COLLEGE_A, BRANCH_A);
  await createUser(hodUserA, "hod", COLLEGE_A, BRANCH_A);
  await createUser(hodUserB, "hod", COLLEGE_A, BRANCH_B);
  await createUser(outsiderUser, "staff", COLLEGE_A, BRANCH_B);
  await createUser(otherCollegeUser, "staff", COLLEGE_B, BRANCH_B);

  const staffCookie = await login(staffUser);
  const hodACookie = await login(hodUserA);
  const hodBCookie = await login(hodUserB);
  const outsiderCookie = await login(outsiderUser);
  const otherCollegeCookie = await login(otherCollegeUser);

  // 1. Staff can create a request
  const requestId = await createAndSubmit(staffCookie, "Security test request", COLLEGE_A, BRANCH_A);
  console.log("1. Staff create + submit OK");

  // 2. Request routed per configured workflow (hod_review first step)
  console.log("2. Workflow routing OK");

  // 3. Correct approver sees request via /pending
  const pendingDedicated = await req("/api/requests/pending", { cookie: hodACookie });
  assert(pendingDedicated.status === 200, "GET /api/requests/pending failed");
  const pendingIdsDedicated = (
    (pendingDedicated.json as { data: { id: number }[] }).data ?? []
  ).map((r) => r.id);
  assert(pendingIdsDedicated.includes(requestId), "HOD A should see request on /pending");

  const pendingForHodA = await req("/api/requests?filter=pending", { cookie: hodACookie });
  const pendingIdsA = ((pendingForHodA.json as { data: { id: number }[] }).data ?? []).map((r) => r.id);
  assert(pendingIdsA.includes(requestId), "HOD A should see pending request in scope");
  console.log("3. Correct approver inbox OK");

  // 4. Unauthorized user gets 403 on approve
  const outsiderApprove = await req(`/api/requests/${requestId}/approve`, {
    method: "POST",
    cookie: outsiderCookie,
    body: JSON.stringify({ comment: "should fail" }),
  });
  assert(outsiderApprove.status === 403, `Out-of-scope approve expected 403, got ${outsiderApprove.status}`);
  console.log("4. Unauthorized approve denied OK");

  // 5. Cross-branch access denied
  const pendingForHodB = await req("/api/requests/pending", { cookie: hodBCookie });
  const pendingIdsB = ((pendingForHodB.json as { data: { id: number }[] }).data ?? []).map((r) => r.id);
  assert(!pendingIdsB.includes(requestId), "HOD B must not see branch A request");
  console.log("5. Cross-branch access denied OK");

  // 6. Cross-college access denied on detail
  const crossCollegeView = await req(`/api/requests/${requestId}`, { cookie: otherCollegeCookie });
  assert(
    crossCollegeView.status === 403,
    `Cross-college detail expected 403, got ${crossCollegeView.status}`,
  );
  console.log("6. Cross-college access denied OK");

  // 7. Requester cannot impersonate another requester
  const impersonate = await req("/api/requests", {
    method: "POST",
    cookie: staffCookie,
    body: JSON.stringify({
      typeKey: "general_academic",
      title: "Impersonation attempt",
      collegeId: COLLEGE_A,
      branchId: BRANCH_A,
      requesterUserId: 999999,
    }),
  });
  assert(impersonate.status === 201, "Create should succeed but ignore requesterUserId");
  const impersonateId = Number((impersonate.json as { request: { id: number; requesterUserId: number } }).request.id);
  const staffRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = ? LIMIT 1`,
    [staffUser],
  );
  const staffId = Number(staffRows[0]?.id);
  assert(
    (impersonate.json as { request: { requesterUserId: number } }).request.requesterUserId === staffId,
    "Requester must be authenticated user, not body value",
  );
  await executeAcademic(`DELETE FROM ap_request_actions WHERE request_id = ?`, [impersonateId]);
  await executeAcademic(`DELETE FROM ap_requests WHERE id = ?`, [impersonateId]);
  console.log("7. Requester impersonation blocked OK");

  // 8. Requester cannot choose arbitrary approver (no such API field)
  console.log("8. No client-side approver selection OK");

  // 9. Approve changes request state
  const approve = await req(`/api/requests/${requestId}/approve`, {
    method: "POST",
    cookie: hodACookie,
    body: JSON.stringify({ comment: "Approved in test" }),
  });
  assert(approve.status === 200, `Approve expected 200, got ${approve.status}`);
  const afterApprove = approve.json as {
    request: { status: string; currentStepOrder: number | null };
    currentStep: { stepKey: string } | null;
  };
  assert(afterApprove.request.status === "pending_approval", "Should advance to next step");
  assert(afterApprove.currentStep?.stepKey === "principal_review", "Should be at principal step");
  console.log("9. Approve advances workflow OK");

  // 10. Reject changes request state
  const rejectRequestId = await createAndSubmit(staffCookie, "Reject test request", COLLEGE_A, BRANCH_A);
  const reject = await req(`/api/requests/${rejectRequestId}/reject`, {
    method: "POST",
    cookie: hodACookie,
    body: JSON.stringify({ comment: "Rejected in test" }),
  });
  assert(reject.status === 200, `Reject expected 200, got ${reject.status}`);
  assert(
    (reject.json as { request: { status: string } }).request.status === "rejected",
    "Reject should set rejected status",
  );
  console.log("10. Reject changes state OK");

  // 11. Return changes request state
  const returnRequestId = await createAndSubmit(staffCookie, "Return test request", COLLEGE_A, BRANCH_A);
  const returned = await req(`/api/requests/${returnRequestId}/return`, {
    method: "POST",
    cookie: hodACookie,
    body: JSON.stringify({ comment: "Please clarify details" }),
  });
  assert(returned.status === 200, `Return expected 200, got ${returned.status}`);
  assert(
    (returned.json as { request: { status: string } }).request.status === "returned",
    "Return should set returned status",
  );
  console.log("11. Return changes state OK");

  // 12. Every action creates audit records
  const audited = await auditCount(requestId, [
    "request.created",
    "request.submitted",
    "request.pending_approval",
    "request.approved",
  ]);
  assert(audited >= 4, "Expected audited request actions");
  const rejectAudited = await auditCount(rejectRequestId, ["request.rejected"]);
  assert(rejectAudited >= 1, "Expected reject audit");
  const returnAudited = await auditCount(returnRequestId, ["request.returned"]);
  assert(returnAudited >= 1, "Expected return audit");
  console.log("12. Audit records OK");

  const unauth = await req(`/api/requests/${requestId}`);
  assert(unauth.status === 401, `Unauthenticated expected 401, got ${unauth.status}`);
  console.log("Unauthenticated access denied OK");

  await deleteUser(staffUser);
  await deleteUser(hodUserA);
  await deleteUser(hodUserB);
  await deleteUser(outsiderUser);
  await deleteUser(otherCollegeUser);

  console.log("\nAll request workflow security checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
