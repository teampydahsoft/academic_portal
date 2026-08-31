/**
 * Request workflow administration verification.
 * Requires API server running and request workflow migration applied.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { executeAcademic, queryAcademic } from "../db/pools.js";

const base = `http://127.0.0.1:${env.port}`;
const password = "WorkflowMgmt!234";

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
  const roleRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  assert(roleRows[0]?.id, `Role ${roleKey} missing`);
  const roleId = Number(roleRows[0].id);
  const permRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_permissions WHERE permission_key = ? LIMIT 1`,
    [permissionKey],
  );
  assert(permRows[0]?.id, `Permission ${permissionKey} missing`);
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

async function ensureRoleId(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  assert(rows[0]?.id, `Role ${roleKey} missing`);
  return Number(rows[0].id);
}

async function createUser(username: string, roleKey: string, collegeId: number | null, branchId: number | null) {
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
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [id]);
}

async function loadGeneralAcademicWorkflow() {
  const rows = await queryAcademic<
    (RowDataPacket & {
      workflow_id: number;
      step_order: number;
      step_key: string;
      label: string;
      approver_role_key: string;
      scope_mode: string;
    })[]
  >(
    `
    SELECT w.id AS workflow_id, s.step_order, s.step_key, s.label, s.approver_role_key, s.scope_mode
    FROM ap_request_types t
    INNER JOIN ap_request_workflows w ON w.request_type_id = t.id AND w.is_active = 1
    INNER JOIN ap_request_workflow_steps s ON s.workflow_id = w.id
    WHERE t.type_key = 'general_academic'
    ORDER BY s.step_order ASC
    `,
  );
  assert(rows.length >= 1, "general_academic workflow must exist");
  return rows;
}

async function auditWorkflowActions(workflowId: number, actions: string[]) {
  const placeholders = actions.map(() => "?").join(", ");
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM ap_audit_logs
    WHERE entity_type IN ('ap_request_workflow', 'ap_request_workflow_step')
      AND (entity_id = ? OR action LIKE 'workflow.%')
      AND action IN (${placeholders})
    `,
    [workflowId, ...actions],
  );
  return Number(rows[0]?.c ?? 0);
}

async function restoreGeneralAcademicSteps(cookie: string, workflowId: number) {
  const steps = await loadGeneralAcademicWorkflow();
  const unique = new Map<string, (typeof steps)[number]>();
  for (const step of steps) {
    if (!unique.has(step.step_key)) unique.set(step.step_key, step);
  }
  const seedOrder = ["hod_review", "principal_review", "management_review"];
  const payload = seedOrder
    .map((key) => unique.get(key))
    .filter(Boolean)
    .map((step) => ({
      stepKey: step!.step_key,
      label: step!.label,
      approverRoleKey: step!.approver_role_key,
      scopeMode: step!.scope_mode,
      requiredPermission: "request.approve",
      allowEscalate: false,
    }));

  if (payload.length !== 3) return;

  await req(`/api/request-workflows/workflows/${workflowId}/steps`, {
    method: "PUT",
    cookie,
    body: JSON.stringify({ steps: payload }),
  });
}

async function main() {
  console.log("=== Request workflow management verification ===\n");

  await ensureRolePermission("management", "request.workflow.manage");

  const mgrUser = "wf_mgr_tmp";
  const deniedUser = "wf_denied_tmp";
  const staffUser = "wf_staff_tmp";

  await createUser(mgrUser, "management", null, null);
  await createUser(deniedUser, "faculty", 1, 1);
  await createUser(staffUser, "faculty", 1, 1);
  await ensureRolePermission("faculty", "request.view");
  await ensureRolePermission("faculty", "request.create");

  const deniedCookie = await login(deniedUser);
  const mgrCookie = await login(mgrUser);
  const staffCookie = await login(staffUser);

  const forbidden = await req("/api/request-workflows/types", { cookie: deniedCookie });
  assert(forbidden.status === 403, `Unauthorized user expected 403, got ${forbidden.status}`);
  console.log("1. Unauthorized user blocked (403)");

  const typesRes = await req("/api/request-workflows/types", { cookie: mgrCookie });
  assert(typesRes.status === 200, `Authorized list expected 200, got ${typesRes.status}`);
  const types = (typesRes.json as { data: Array<{ typeKey: string; activeWorkflow: { id: number } | null }> })
    .data;
  const general = types.find((t) => t.typeKey === "general_academic");
  assert(general?.activeWorkflow?.id, "general_academic type with active workflow must exist");
  const workflowId = Number(general.activeWorkflow.id);
  await restoreGeneralAcademicSteps(mgrCookie, workflowId);
  console.log("2. Authorized workflow type list OK");

  const originalSteps = await loadGeneralAcademicWorkflow();
  assert(originalSteps.length === 3, `general_academic should keep 3 seeded steps initially (got ${originalSteps.length})`);
  console.log("3. Existing general_academic workflow preserved");

  const detailRes = await req(`/api/request-workflows/workflows/${workflowId}`, { cookie: mgrCookie });
  assert(detailRes.status === 200, `Workflow detail expected 200, got ${detailRes.status}`);
  const detail = detailRes.json as { steps: Array<{ approverRoleKey: string }> };
  assert(detail.steps.length === 3, "Workflow detail should return 3 steps");
  console.log("4. Workflow detail loaded");

  const rolesRes = await req("/api/request-workflows/approver-roles", { cookie: mgrCookie });
  assert(rolesRes.status === 200, `Approver roles expected 200, got ${rolesRes.status}`);
  const roles = (rolesRes.json as { data: Array<{ roleKey: string; label: string }> }).data;
  assert(roles.length > 0, "Active roles must be returned dynamically");
  const extraRole = roles.find((r) => r.roleKey !== detail.steps[0]?.approverRoleKey) ?? roles[0]!;
  console.log("5. Dynamic approver roles loaded");

  const invalidRoleSave = await req(`/api/request-workflows/workflows/${workflowId}/steps`, {
    method: "PUT",
    cookie: mgrCookie,
    body: JSON.stringify({
      steps: [
        {
          label: "Invalid",
          approverRoleKey: "role_that_does_not_exist_zzz",
          scopeMode: "global",
        },
      ],
    }),
  });
  assert(invalidRoleSave.status === 400, `Invalid role expected 400, got ${invalidRoleSave.status}`);
  console.log("6. Invalid approver role rejected");

  const detailFull = detailRes.json as {
    steps: Array<{
      id: number;
      stepKey: string;
      label: string;
      approverRoleKey: string;
      scopeMode: string;
    }>;
  };
  const reordered = [...detailFull.steps].reverse().map((step) => ({
    id: step.id,
    stepKey: step.stepKey,
    label: step.label,
    approverRoleKey: step.approverRoleKey,
    scopeMode: step.scopeMode,
    requiredPermission: "request.approve",
    allowEscalate: false,
  }));

  const saveReorder = await req(`/api/request-workflows/workflows/${workflowId}/steps`, {
    method: "PUT",
    cookie: mgrCookie,
    body: JSON.stringify({ steps: reordered }),
  });
  assert(saveReorder.status === 200, `Reorder save expected 200, got ${saveReorder.status}`);
  console.log("7. Reorder steps OK");

  const currentDetail = await req(`/api/request-workflows/workflows/${workflowId}`, { cookie: mgrCookie });
  const currentSteps = (currentDetail.json as { steps: Array<Record<string, unknown>> }).steps;
  const addStepPayload = [
    ...currentSteps.map((step) => ({
      id: step.id,
      stepKey: step.stepKey,
      label: step.label,
      approverRoleKey: step.approverRoleKey,
      scopeMode: step.scopeMode,
      requiredPermission: "request.approve",
      allowEscalate: step.allowEscalate ?? false,
    })),
    {
      label: "Additional review",
      approverRoleKey: extraRole.roleKey,
      scopeMode: "same_college",
      requiredPermission: "request.approve",
      allowEscalate: false,
    },
  ];

  const addRes = await req(`/api/request-workflows/workflows/${workflowId}/steps`, {
    method: "PUT",
    cookie: mgrCookie,
    body: JSON.stringify({ steps: addStepPayload }),
  });
  assert(addRes.status === 200, `Add step expected 200, got ${addRes.status}`);
  const addedDetail = addRes.json as { steps: unknown[] };
  assert(addedDetail.steps.length === originalSteps.length + 1, "Step should be added");
  console.log("8. Add dynamic role step OK");

  const removePayload = originalSteps.map((step) => ({
    stepKey: step.step_key,
    label: step.label,
    approverRoleKey: step.approver_role_key,
    scopeMode: step.scope_mode,
    requiredPermission: "request.approve",
    allowEscalate: false,
  }));
  const restoreRes = await req(`/api/request-workflows/workflows/${workflowId}/steps`, {
    method: "PUT",
    cookie: mgrCookie,
    body: JSON.stringify({ steps: removePayload }),
  });
  assert(restoreRes.status === 200, `Restore workflow expected 200, got ${restoreRes.status}`);
  const restored = restoreRes.json as { steps: unknown[] };
  assert(restored.steps.length === 3, "Workflow should be restored to 3 steps");
  console.log("9. Remove step / restore original workflow OK");

  const deactivate = await req(`/api/request-workflows/workflows/${workflowId}`, {
    method: "PATCH",
    cookie: mgrCookie,
    body: JSON.stringify({ isActive: false }),
  });
  assert(deactivate.status === 200, `Deactivate expected 200, got ${deactivate.status}`);
  const activate = await req(`/api/request-workflows/workflows/${workflowId}`, {
    method: "PATCH",
    cookie: mgrCookie,
    body: JSON.stringify({ isActive: true }),
  });
  assert(activate.status === 200, `Activate expected 200, got ${activate.status}`);
  console.log("10. Activate/deactivate workflow OK");

  const auditCount = await auditWorkflowActions(workflowId, [
    "workflow.updated",
    "workflow.step.added",
    "workflow.steps.reordered",
    "workflow.activated",
    "workflow.deactivated",
  ]);
  assert(auditCount > 0, "Audit entries should be created for workflow administration");
  console.log("11. Audit entries created");

  const create = await req("/api/requests", {
    method: "POST",
    cookie: staffCookie,
    body: JSON.stringify({
      typeKey: "general_academic",
      title: "Workflow mgmt regression",
      body: "Ensure runtime still works",
      collegeId: 1,
      branchId: 1,
    }),
  });
  assert(create.status === 201, `Request create expected 201, got ${create.status}`);
  const requestId = Number((create.json as { request: { id: number } }).request.id);
  const submit = await req(`/api/requests/${requestId}/submit`, {
    method: "POST",
    cookie: staffCookie,
    body: "{}",
  });
  assert(submit.status === 200, `Request submit expected 200, got ${submit.status}`);
  const submitted = submit.json as {
    request: { status: string };
    currentStep: { stepOrder: number } | null;
  };
  assert(submitted.request.status === "pending_approval", "Submitted request should be pending");
  assert(submitted.currentStep?.stepOrder === 1, "First step should be active after restore");
  console.log("12. Existing request submission still works");

  await executeAcademic(`DELETE FROM ap_request_actions WHERE request_id = ?`, [requestId]);
  await executeAcademic(`DELETE FROM ap_requests WHERE id = ?`, [requestId]);

  await deleteUser(mgrUser);
  await deleteUser(deniedUser);
  await deleteUser(staffUser);

  console.log("\nAll request workflow management checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
