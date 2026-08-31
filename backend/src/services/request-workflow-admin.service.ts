import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { executeAcademic, queryAcademic, withAcademicTransaction } from "../db/pools.js";
import type { AuthzContext } from "../authz/authorization.service.js";
import { hasPermission } from "../authz/authorization.service.js";
import type { ScopeMode } from "./request-workflow.service.js";
import { writeAuditLog } from "./audit.service.js";

const SCOPE_MODES: ScopeMode[] = [
  "requester_scope",
  "same_college",
  "same_branch",
  "global",
];

type TypeRow = RowDataPacket & {
  id: number;
  type_key: string;
  label: string;
  description: string | null;
  is_active: number;
  created_at: string;
};

type WorkflowRow = RowDataPacket & {
  id: number;
  request_type_id: number;
  workflow_key: string;
  label: string;
  is_active: number;
  created_at: string;
};

type StepRow = RowDataPacket & {
  id: number;
  workflow_id: number;
  step_order: number;
  step_key: string;
  label: string;
  approver_role_key: string | null;
  required_permission: string | null;
  scope_mode: ScopeMode;
  allow_escalate: number;
  is_final: number;
};

export type WorkflowStepInput = {
  id?: number | null;
  stepKey?: string;
  label: string;
  approverRoleKey: string;
  requiredPermission?: string;
  scopeMode: ScopeMode;
  allowEscalate?: boolean;
  isFinal?: boolean;
};

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function slugify(value: string, max = 64): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return base || `item_${Date.now()}`;
}

function mapStep(row: StepRow) {
  return {
    id: Number(row.id),
    workflowId: Number(row.workflow_id),
    stepOrder: Number(row.step_order),
    stepKey: row.step_key,
    label: row.label,
    approverRoleKey: row.approver_role_key,
    requiredPermission: row.required_permission,
    scopeMode: row.scope_mode,
    allowEscalate: Number(row.allow_escalate) === 1,
    isFinal: Number(row.is_final) === 1,
  };
}

function mapType(row: TypeRow) {
  return {
    id: Number(row.id),
    typeKey: row.type_key,
    label: row.label,
    description: row.description,
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
  };
}

function mapWorkflow(row: WorkflowRow) {
  return {
    id: Number(row.id),
    requestTypeId: Number(row.request_type_id),
    workflowKey: row.workflow_key,
    label: row.label,
    isActive: Number(row.is_active) === 1,
    createdAt: row.created_at,
  };
}

export function assertWorkflowManageAccess(authz: AuthzContext) {
  if (!hasPermission(authz, "request.workflow.manage")) {
    fail(403, "request.workflow.manage permission required");
  }
  if (!authz.scope.isGlobal) {
    fail(
      403,
      "Request workflow configuration is global. Only users with global scope may manage workflows.",
    );
  }
}

export async function countActiveWorkflowReferencesForRole(roleKey: string): Promise<number> {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM ap_request_workflow_steps s
    INNER JOIN ap_request_workflows w ON w.id = s.workflow_id
    WHERE s.approver_role_key = ? AND w.is_active = 1
    `,
    [roleKey],
  );
  return Number(rows[0]?.c ?? 0);
}

async function assertActiveRole(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { role_key: string; label: string })[]>(
    `
    SELECT role_key, label
    FROM ap_roles
    WHERE role_key = ? AND is_active = 1
    LIMIT 1
    `,
    [roleKey],
  );
  if (!rows[0]) {
    fail(400, `Approver role "${roleKey}" does not exist or is inactive`);
  }
  return rows[0];
}

async function assertValidPermission(permissionKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { permission_key: string })[]>(
    `
    SELECT permission_key
    FROM ap_permissions
    WHERE permission_key = ? AND is_active = 1 AND module = 'request'
    LIMIT 1
    `,
    [permissionKey],
  );
  if (!rows[0]) {
    fail(400, `Permission "${permissionKey}" is not a valid active request permission`);
  }
}

async function loadType(typeId: number) {
  const rows = await queryAcademic<TypeRow[]>(
    `SELECT * FROM ap_request_types WHERE id = ? LIMIT 1`,
    [typeId],
  );
  return rows[0] ?? null;
}

async function loadWorkflow(workflowId: number) {
  const rows = await queryAcademic<WorkflowRow[]>(
    `SELECT * FROM ap_request_workflows WHERE id = ? LIMIT 1`,
    [workflowId],
  );
  return rows[0] ?? null;
}

async function loadWorkflowSteps(workflowId: number) {
  const rows = await queryAcademic<StepRow[]>(
    `
    SELECT *
    FROM ap_request_workflow_steps
    WHERE workflow_id = ?
    ORDER BY step_order ASC
    `,
    [workflowId],
  );
  return rows.map(mapStep);
}

async function loadReferencedStepIds(workflowId: number): Promise<Set<number>> {
  const rows = await queryAcademic<(RowDataPacket & { step_id: number })[]>(
    `
    SELECT DISTINCT r.current_step_id AS step_id
    FROM ap_requests r
    WHERE r.workflow_id = ?
      AND r.current_step_id IS NOT NULL
      AND r.status IN ('submitted', 'pending_approval', 'returned')
    `,
    [workflowId],
  );
  return new Set(rows.map((row) => Number(row.step_id)));
}

function validateStepsForSave(steps: WorkflowStepInput[]) {
  if (!steps.length) {
    fail(400, "Workflow must have at least one approval step");
  }

  const keys = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const order = i + 1;
    if (!step.label?.trim()) {
      fail(400, `Step ${order} requires a label`);
    }
    if (!step.approverRoleKey?.trim()) {
      fail(400, `Step ${order} requires an approver role`);
    }
    const stepKey = slugify(step.stepKey?.trim() || step.label);
    if (keys.has(stepKey)) {
      fail(400, `Duplicate step key "${stepKey}"`);
    }
    keys.add(stepKey);
    if (!SCOPE_MODES.includes(step.scopeMode)) {
      fail(400, `Step ${order} has invalid scope mode`);
    }
    step.requiredPermission = step.requiredPermission?.trim() || "request.approve";
  }

  const last = steps.at(-1)!;
  for (let i = 0; i < steps.length; i++) {
    steps[i]!.isFinal = i === steps.length - 1;
  }
  if (!last.approverRoleKey) {
    fail(400, "Final step requires an approver role");
  }
}

async function validateStepsRolesAndPermissions(steps: WorkflowStepInput[]) {
  for (const step of steps) {
    await assertActiveRole(step.approverRoleKey);
    await assertValidPermission(step.requiredPermission ?? "request.approve");
  }
}

async function assertWorkflowActivatable(workflowId: number, steps: WorkflowStepInput[]) {
  validateStepsForSave(steps);
  await validateStepsRolesAndPermissions(steps);
  const referenced = await loadReferencedStepIds(workflowId);
  if (referenced.size > 0 && steps.length === 0) {
    fail(400, "Cannot remove all steps while requests are in progress");
  }
}

export async function listApproverRoles(authz: AuthzContext) {
  assertWorkflowManageAccess(authz);
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      role_key: string;
      label: string;
      description: string | null;
      is_global_capable: number;
    })[]
  >(
    `
    SELECT id, role_key, label, description, is_global_capable
    FROM ap_roles
    WHERE is_active = 1
    ORDER BY label ASC, role_key ASC
    `,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    roleKey: row.role_key,
    label: row.label,
    description: row.description,
    isGlobalCapable: Number(row.is_global_capable) === 1,
  }));
}

export async function listRequestTypesAdmin(authz: AuthzContext) {
  assertWorkflowManageAccess(authz);
  const types = await queryAcademic<TypeRow[]>(
    `SELECT * FROM ap_request_types ORDER BY label ASC, type_key ASC`,
  );

  const workflows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      request_type_id: number;
      workflow_key: string;
      label: string;
      is_active: number;
      step_count: number;
    })[]
  >(
    `
    SELECT w.id, w.request_type_id, w.workflow_key, w.label, w.is_active,
           COUNT(s.id) AS step_count
    FROM ap_request_workflows w
    LEFT JOIN ap_request_workflow_steps s ON s.workflow_id = w.id
    GROUP BY w.id
    ORDER BY w.request_type_id ASC, w.is_active DESC, w.id DESC
    `,
  );

  const workflowsByType = new Map<number, typeof workflows>();
  for (const row of workflows) {
    const typeId = Number(row.request_type_id);
    const list = workflowsByType.get(typeId) ?? [];
    list.push(row);
    workflowsByType.set(typeId, list);
  }

  return types.map((type) => {
    const mapped = mapType(type);
    const typeWorkflows = (workflowsByType.get(mapped.id) ?? []).map((w) => ({
      id: Number(w.id),
      workflowKey: w.workflow_key,
      label: w.label,
      isActive: Number(w.is_active) === 1,
      stepCount: Number(w.step_count),
    }));
    const activeWorkflow = typeWorkflows.find((w) => w.isActive) ?? null;
    return {
      ...mapped,
      workflows: typeWorkflows,
      activeWorkflow,
    };
  });
}

export async function createRequestType(
  authz: AuthzContext,
  input: { typeKey: string; label: string; description?: string | null; isActive?: boolean },
  ipAddress?: string | null,
) {
  assertWorkflowManageAccess(authz);
  const typeKey = slugify(input.typeKey, 64);
  const label = input.label?.trim();
  if (!label) fail(400, "label is required");

  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_request_types WHERE type_key = ? LIMIT 1`,
    [typeKey],
  );
  if (existing[0]) {
    fail(409, `Request type "${typeKey}" already exists`);
  }

  const result = await executeAcademic(
    `
    INSERT INTO ap_request_types (type_key, label, description, is_active)
    VALUES (?, ?, ?, ?)
    `,
    [typeKey, label, input.description?.trim() || null, input.isActive === false ? 0 : 1],
  );
  const typeId = Number(result.insertId);

  await writeAuditLog({
    actorUserId: authz.userId,
    action: "workflow.created",
    entityType: "ap_request_type",
    entityId: typeId,
    newValue: { typeKey, label, isActive: input.isActive !== false },
    ipAddress,
  });

  const type = await loadType(typeId);
  return mapType(type!);
}

export async function updateRequestType(
  authz: AuthzContext,
  typeId: number,
  input: { label?: string; description?: string | null; isActive?: boolean },
  ipAddress?: string | null,
) {
  assertWorkflowManageAccess(authz);
  const existing = await loadType(typeId);
  if (!existing) fail(404, "Request type not found");

  const label = input.label?.trim() || existing.label;
  const description =
    input.description !== undefined ? input.description?.trim() || null : existing.description;
  const isActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active;

  if (!label.trim()) fail(400, "label cannot be empty");

  if (Number(isActive) === 0) {
    const activeRequests = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `
      SELECT COUNT(*) AS c
      FROM ap_requests
      WHERE request_type_id = ? AND status IN ('submitted', 'pending_approval', 'returned', 'draft')
      `,
      [typeId],
    );
    if (Number(activeRequests[0]?.c ?? 0) > 0) {
      fail(400, "Cannot deactivate request type while open requests exist");
    }
  }

  await executeAcademic(
    `
    UPDATE ap_request_types
    SET label = ?, description = ?, is_active = ?
    WHERE id = ?
    `,
    [label, description, isActive, typeId],
  );

  await writeAuditLog({
    actorUserId: authz.userId,
    action: "workflow.updated",
    entityType: "ap_request_type",
    entityId: typeId,
    oldValue: mapType(existing),
    newValue: { label, description, isActive: Number(isActive) === 1 },
    ipAddress,
  });

  const updated = await loadType(typeId);
  return mapType(updated!);
}

export async function getWorkflowAdmin(authz: AuthzContext, workflowId: number) {
  assertWorkflowManageAccess(authz);
  const workflow = await loadWorkflow(workflowId);
  if (!workflow) fail(404, "Workflow not found");

  const type = await loadType(Number(workflow.request_type_id));
  const steps = await loadWorkflowSteps(workflowId);
  const roles = await listApproverRoles(authz);
  const roleByKey = new Map(roles.map((r) => [r.roleKey, r]));

  return {
    workflow: mapWorkflow(workflow),
    requestType: type ? mapType(type) : null,
    steps: steps.map((step) => ({
      ...step,
      approverRoleLabel: step.approverRoleKey
        ? (roleByKey.get(step.approverRoleKey)?.label ?? step.approverRoleKey)
        : null,
    })),
  };
}

export async function createWorkflow(
  authz: AuthzContext,
  typeId: number,
  input: { workflowKey?: string; label: string; isActive?: boolean },
  ipAddress?: string | null,
) {
  assertWorkflowManageAccess(authz);
  const type = await loadType(typeId);
  if (!type) fail(404, "Request type not found");

  const workflowKey = slugify(input.workflowKey?.trim() || input.label, 64);
  const label = input.label?.trim();
  if (!label) fail(400, "label is required");

  const duplicate = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `
    SELECT id FROM ap_request_workflows
    WHERE request_type_id = ? AND workflow_key = ?
    LIMIT 1
    `,
    [typeId, workflowKey],
  );
  if (duplicate[0]) {
    fail(409, `Workflow "${workflowKey}" already exists for this request type`);
  }

  const shouldActivate = input.isActive !== false;

  const result = await withAcademicTransaction(async (conn) => {
    if (shouldActivate) {
      await conn.execute(
        `UPDATE ap_request_workflows SET is_active = 0 WHERE request_type_id = ?`,
        [typeId],
      );
    }

    const [insertResult] = await conn.execute(
      `
      INSERT INTO ap_request_workflows (request_type_id, workflow_key, label, is_active)
      VALUES (?, ?, ?, ?)
      `,
      [typeId, workflowKey, label, shouldActivate ? 1 : 0],
    );
    const workflowId = Number((insertResult as { insertId: number }).insertId);
    return workflowId;
  });

  await writeAuditLog({
    actorUserId: authz.userId,
    action: shouldActivate ? "workflow.activated" : "workflow.created",
    entityType: "ap_request_workflow",
    entityId: result,
    newValue: { requestTypeId: typeId, workflowKey, label, isActive: shouldActivate },
    ipAddress,
  });

  return getWorkflowAdmin(authz, result);
}

export async function updateWorkflow(
  authz: AuthzContext,
  workflowId: number,
  input: { label?: string; isActive?: boolean },
  ipAddress?: string | null,
) {
  assertWorkflowManageAccess(authz);
  const existing = await loadWorkflow(workflowId);
  if (!existing) fail(404, "Workflow not found");

  const label = input.label?.trim() || existing.label;
  const nextActive =
    input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active;

  if (!label.trim()) fail(400, "label cannot be empty");

  if (Number(nextActive) === 1) {
    const steps = await loadWorkflowSteps(workflowId);
    if (!steps.length) {
      fail(400, "Cannot activate workflow without approval steps");
    }
    await assertWorkflowActivatable(
      workflowId,
      steps.map((s) => ({
        id: s.id,
        stepKey: s.stepKey,
        label: s.label,
        approverRoleKey: s.approverRoleKey ?? "",
        requiredPermission: s.requiredPermission ?? "request.approve",
        scopeMode: s.scopeMode,
        allowEscalate: s.allowEscalate,
        isFinal: s.isFinal,
      })),
    );
  }

  await withAcademicTransaction(async (conn) => {
    if (Number(nextActive) === 1) {
      await conn.execute(
        `UPDATE ap_request_workflows SET is_active = 0 WHERE request_type_id = ? AND id <> ?`,
        [existing.request_type_id, workflowId],
      );
    }
    await conn.execute(`UPDATE ap_request_workflows SET label = ?, is_active = ? WHERE id = ?`, [
      label,
      nextActive,
      workflowId,
    ]);
  });

  const auditAction =
    input.isActive === true
      ? "workflow.activated"
      : input.isActive === false
        ? "workflow.deactivated"
        : "workflow.updated";

  await writeAuditLog({
    actorUserId: authz.userId,
    action: auditAction,
    entityType: "ap_request_workflow",
    entityId: workflowId,
    oldValue: mapWorkflow(existing),
    newValue: { label, isActive: Number(nextActive) === 1 },
    ipAddress,
  });

  return getWorkflowAdmin(authz, workflowId);
}

type StepDiff = {
  added: WorkflowStepInput[];
  updated: Array<{ before: ReturnType<typeof mapStep>; after: WorkflowStepInput & { stepKey: string } }>;
  removed: ReturnType<typeof mapStep>[];
  reordered: boolean;
};

function diffSteps(
  before: ReturnType<typeof mapStep>[],
  after: Array<WorkflowStepInput & { stepKey: string }>,
): StepDiff {
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterIds = new Set(after.filter((s) => s.id).map((s) => Number(s.id)));

  const removed = before.filter((s) => !afterIds.has(s.id));
  const added = after.filter((s) => !s.id);
  const updated: StepDiff["updated"] = [];

  for (const step of after) {
    if (!step.id) continue;
    const prev = beforeById.get(step.id);
    if (!prev) continue;
    const changed =
      prev.label !== step.label ||
      prev.approverRoleKey !== step.approverRoleKey ||
      prev.requiredPermission !== (step.requiredPermission ?? "request.approve") ||
      prev.scopeMode !== step.scopeMode ||
      prev.allowEscalate !== Boolean(step.allowEscalate) ||
      prev.isFinal !== Boolean(step.isFinal) ||
      prev.stepKey !== step.stepKey;
    if (changed) {
      updated.push({ before: prev, after: step });
    }
  }

  const reordered = before.some((prev, index) => {
    const match = after[index];
    return !match || (match.id && Number(match.id) !== prev.id);
  });

  return { added, updated, removed, reordered };
}

export async function saveWorkflowSteps(
  authz: AuthzContext,
  workflowId: number,
  stepsInput: WorkflowStepInput[],
  ipAddress?: string | null,
) {
  assertWorkflowManageAccess(authz);
  const workflow = await loadWorkflow(workflowId);
  if (!workflow) fail(404, "Workflow not found");

  validateStepsForSave(stepsInput);
  await validateStepsRolesAndPermissions(stepsInput);

  const normalized = stepsInput.map((step, index) => ({
    ...step,
    stepKey: slugify(step.stepKey?.trim() || step.label),
    requiredPermission: step.requiredPermission?.trim() || "request.approve",
    allowEscalate: Boolean(step.allowEscalate),
    isFinal: index === stepsInput.length - 1,
    stepOrder: index + 1,
  }));

  const before = await loadWorkflowSteps(workflowId);
  const referenced = await loadReferencedStepIds(workflowId);
  const diff = diffSteps(before, normalized);

  for (const removed of diff.removed) {
    if (referenced.has(removed.id)) {
      fail(
        409,
        `Cannot remove step "${removed.label}" while requests are pending at this step`,
      );
    }
  }

  await withAcademicTransaction(async (conn) => {
    await saveStepsTransaction(conn, workflowId, before, normalized, referenced);
  });

  if (diff.added.length) {
    for (const step of diff.added) {
      await writeAuditLog({
        actorUserId: authz.userId,
        action: "workflow.step.added",
        entityType: "ap_request_workflow",
        entityId: workflowId,
        newValue: step,
        ipAddress,
      });
    }
  }
  for (const { before: prev, after } of diff.updated) {
    await writeAuditLog({
      actorUserId: authz.userId,
      action: "workflow.step.updated",
      entityType: "ap_request_workflow_step",
      entityId: prev.id,
      oldValue: prev,
      newValue: after,
      ipAddress,
    });
  }
  for (const removed of diff.removed) {
    await writeAuditLog({
      actorUserId: authz.userId,
      action: "workflow.step.removed",
      entityType: "ap_request_workflow_step",
      entityId: removed.id,
      oldValue: removed,
      ipAddress,
    });
  }
  if (diff.reordered) {
    await writeAuditLog({
      actorUserId: authz.userId,
      action: "workflow.steps.reordered",
      entityType: "ap_request_workflow",
      entityId: workflowId,
      oldValue: { stepIds: before.map((s) => s.id) },
      newValue: { stepIds: normalized.filter((s) => s.id).map((s) => Number(s.id)) },
      ipAddress,
    });
  }

  await writeAuditLog({
    actorUserId: authz.userId,
    action: "workflow.updated",
    entityType: "ap_request_workflow",
    entityId: workflowId,
    newValue: { stepCount: normalized.length },
    ipAddress,
  });

  return getWorkflowAdmin(authz, workflowId);
}

async function saveStepsTransaction(
  conn: PoolConnection,
  workflowId: number,
  before: ReturnType<typeof mapStep>[],
  normalized: Array<WorkflowStepInput & { stepKey: string; stepOrder: number }>,
  referenced: Set<number>,
) {
  const beforeByKey = new Map(before.map((s) => [s.stepKey, s]));
  const resolved = normalized.map((step) => {
    if (step.id) return step;
    const match = beforeByKey.get(step.stepKey);
    if (match) return { ...step, id: match.id };
    return step;
  });

  const afterIds = new Set(
    resolved.filter((s) => s.id).map((s) => Number(s.id)),
  );
  const toDelete = before.filter((s) => !afterIds.has(s.id) && !referenced.has(s.id));

  await conn.execute(
    `UPDATE ap_request_workflow_steps SET step_order = step_order + 1000 WHERE workflow_id = ?`,
    [workflowId],
  );

  for (const step of resolved) {
    if (step.id) {
      await conn.execute(
        `
        UPDATE ap_request_workflow_steps
        SET step_order = ?, step_key = ?, label = ?, approver_role_key = ?,
            required_permission = ?, scope_mode = ?, allow_escalate = ?, is_final = ?
        WHERE id = ? AND workflow_id = ?
        `,
        [
          step.stepOrder,
          step.stepKey,
          step.label.trim(),
          step.approverRoleKey,
          step.requiredPermission ?? "request.approve",
          step.scopeMode,
          step.allowEscalate ? 1 : 0,
          step.isFinal ? 1 : 0,
          step.id,
          workflowId,
        ],
      );
    } else {
      await conn.execute(
        `
        INSERT INTO ap_request_workflow_steps
          (workflow_id, step_order, step_key, label, approver_role_key, required_permission,
           scope_mode, allow_escalate, is_final)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          workflowId,
          step.stepOrder,
          step.stepKey,
          step.label.trim(),
          step.approverRoleKey,
          step.requiredPermission ?? "request.approve",
          step.scopeMode,
          step.allowEscalate ? 1 : 0,
          step.isFinal ? 1 : 0,
        ],
      );
    }
  }

  for (const removed of toDelete) {
    await conn.execute(`DELETE FROM ap_request_workflow_steps WHERE id = ? AND workflow_id = ?`, [
      removed.id,
      workflowId,
    ]);
  }
}
