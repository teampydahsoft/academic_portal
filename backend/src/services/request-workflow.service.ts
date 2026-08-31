import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic, queryStudent } from "../db/pools.js";
import type { AuthzContext } from "../authz/authorization.service.js";
import {
  assertEntityInScope,
  hasPermission,
} from "../authz/authorization.service.js";
import { writeAuditLog } from "./audit.service.js";
import {
  applyFacultySubstitution,
  loadSubstitutionDetailByRequestId,
  loadSubstitutionSummariesForRequests,
  markSubstitutionCancelled,
  SUBSTITUTION_TYPE_KEY,
} from "./faculty-substitution.service.js";

export type RequestStatus =
  | "draft"
  | "submitted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "returned"
  | "cancelled";

export type ScopeMode = "requester_scope" | "same_college" | "same_branch" | "global";

type RequestTypeRow = RowDataPacket & {
  id: number;
  type_key: string;
  label: string;
  description: string | null;
};

type WorkflowRow = RowDataPacket & {
  id: number;
  request_type_id: number;
  workflow_key: string;
  label: string;
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

type RequestRow = RowDataPacket & {
  id: number;
  request_type_id: number;
  workflow_id: number;
  requester_user_id: number;
  college_id: number | null;
  branch_id: number | null;
  title: string;
  body: string | null;
  status: RequestStatus;
  current_step_id: number | null;
  current_step_order: number | null;
  submitted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  type_key?: string;
  type_label?: string;
  requester_name?: string;
  current_step_label?: string;
  college_name?: string | null;
  course_id?: number | null;
  course_name?: string | null;
  branch_name?: string | null;
};

type ScopeLabelRow = RowDataPacket & {
  college_id: number;
  college_name: string;
  course_id: number | null;
  course_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
};

type ActionRow = RowDataPacket & {
  id: number;
  request_id: number;
  actor_user_id: number | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  step_id: number | null;
  step_order: number | null;
  comment: string | null;
  metadata_json: string | null;
  created_at: string;
  actor_name?: string | null;
};

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
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

function mapRequest(row: RequestRow) {
  return {
    id: Number(row.id),
    requestTypeId: Number(row.request_type_id),
    workflowId: Number(row.workflow_id),
    requesterUserId: Number(row.requester_user_id),
    collegeId: row.college_id == null ? null : Number(row.college_id),
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    title: row.title,
    body: row.body,
    status: row.status,
    currentStepId: row.current_step_id == null ? null : Number(row.current_step_id),
    currentStepOrder: row.current_step_order == null ? null : Number(row.current_step_order),
    submittedAt: row.submitted_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    typeKey: row.type_key ?? null,
    typeLabel: row.type_label ?? null,
    requesterName: row.requester_name ?? null,
    currentStepLabel: row.current_step_label ?? null,
    collegeName: row.college_name ?? null,
    courseId: row.course_id == null ? null : Number(row.course_id),
    courseName: row.course_name ?? null,
    branchName: row.branch_name ?? null,
  };
}

async function loadScopeLabels(
  requests: Array<{ collegeId: number | null; branchId: number | null }>,
) {
  const branchIds = [
    ...new Set(
      requests
        .map((request) => request.branchId)
        .filter((id): id is number => id != null),
    ),
  ];
  const collegeOnlyIds = [
    ...new Set(
      requests
        .filter((request) => request.branchId == null && request.collegeId != null)
        .map((request) => request.collegeId as number),
    ),
  ];

  const byBranch = new Map<
    number,
    { collegeId: number; collegeName: string; courseId: number | null; courseName: string | null; branchName: string }
  >();
  const byCollege = new Map<number, string>();

  if (branchIds.length > 0) {
    const placeholders = branchIds.map(() => "?").join(", ");
    const rows = await queryStudent<ScopeLabelRow[]>(
      `
      SELECT
        col.id AS college_id,
        col.name AS college_name,
        c.id AS course_id,
        c.name AS course_name,
        cb.id AS branch_id,
        cb.name AS branch_name
      FROM course_branches cb
      INNER JOIN courses c ON c.id = cb.course_id
      INNER JOIN colleges col ON col.id = c.college_id
      WHERE cb.id IN (${placeholders})
      `,
      branchIds,
    );
    for (const row of rows) {
      if (row.branch_id == null) continue;
      byBranch.set(Number(row.branch_id), {
        collegeId: Number(row.college_id),
        collegeName: row.college_name,
        courseId: row.course_id == null ? null : Number(row.course_id),
        courseName: row.course_name,
        branchName: row.branch_name,
      });
    }
  }

  if (collegeOnlyIds.length > 0) {
    const placeholders = collegeOnlyIds.map(() => "?").join(", ");
    const rows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM colleges WHERE id IN (${placeholders})`,
      collegeOnlyIds,
    );
    for (const row of rows) {
      byCollege.set(Number(row.id), row.name);
    }
  }

  return { byBranch, byCollege };
}

function enrichRequests<T extends { collegeId: number | null; branchId: number | null }>(
  requests: T[],
  labels: Awaited<ReturnType<typeof loadScopeLabels>>,
) {
  return requests.map((request) => {
    if (request.branchId != null) {
      const branch = labels.byBranch.get(request.branchId);
      if (!branch) return request;
      return {
        ...request,
        collegeName: branch.collegeName,
        courseId: branch.courseId,
        courseName: branch.courseName,
        branchName: branch.branchName,
      };
    }
    if (request.collegeId != null) {
      return {
        ...request,
        collegeName: labels.byCollege.get(request.collegeId) ?? null,
      };
    }
    return request;
  });
}

function mapAction(row: ActionRow) {
  let metadata: unknown = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = null;
    }
  }
  return {
    id: Number(row.id),
    requestId: Number(row.request_id),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorName: row.actor_name ?? null,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    stepId: row.step_id == null ? null : Number(row.step_id),
    stepOrder: row.step_order == null ? null : Number(row.step_order),
    comment: row.comment,
    metadata,
    createdAt: row.created_at,
  };
}

function assignmentMatchesScope(
  assignment: AuthzContext["roles"][number],
  request: { collegeId: number | null; branchId: number | null },
  scopeMode: ScopeMode,
): boolean {
  const collegeId = request.collegeId;
  const branchId = request.branchId;

  if (scopeMode === "global") {
    return (
      assignment.collegeId == null &&
      assignment.branchId == null &&
      Boolean(assignment.isGlobalCapable)
    );
  }

  if (collegeId == null) return false;

  if (scopeMode === "same_college") {
    return assignment.collegeId === collegeId;
  }

  if (scopeMode === "same_branch") {
    if (assignment.collegeId !== collegeId) return false;
    if (branchId == null) return assignment.branchId == null;
    return assignment.branchId == null || assignment.branchId === branchId;
  }

  // requester_scope
  if (assignment.collegeId !== collegeId) return false;
  if (branchId == null) return true;
  return assignment.branchId == null || assignment.branchId === branchId;
}

export function isEligibleApproverForStep(
  authz: AuthzContext,
  step: ReturnType<typeof mapStep>,
  request: { collegeId: number | null; branchId: number | null },
): boolean {
  if (!hasPermission(authz, "request.approve")) return false;

  if (step.requiredPermission && !hasPermission(authz, step.requiredPermission)) {
    return false;
  }

  let roleMatched = false;
  if (step.approverRoleKey) {
    roleMatched = authz.roles.some(
      (assignment) =>
        assignment.roleKey === step.approverRoleKey &&
        assignmentMatchesScope(assignment, request, step.scopeMode),
    );
    if (!roleMatched) return false;
  } else {
    try {
      assertEntityInScope(authz, {
        collegeId: request.collegeId,
        branchId: request.branchId,
      });
    } catch {
      return false;
    }
  }

  return true;
}

async function loadRequestById(requestId: number): Promise<RequestRow | null> {
  const rows = await queryAcademic<RequestRow[]>(
    `
    SELECT
      r.*,
      rt.type_key,
      rt.label AS type_label,
      u.name AS requester_name,
      s.label AS current_step_label
    FROM ap_requests r
    INNER JOIN ap_request_types rt ON rt.id = r.request_type_id
    INNER JOIN ap_users u ON u.id = r.requester_user_id
    LEFT JOIN ap_request_workflow_steps s ON s.id = r.current_step_id
    WHERE r.id = ?
    LIMIT 1
    `,
    [requestId],
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

async function loadActiveWorkflowForType(requestTypeId: number) {
  const rows = await queryAcademic<WorkflowRow[]>(
    `
    SELECT *
    FROM ap_request_workflows
    WHERE request_type_id = ? AND is_active = 1
    ORDER BY id DESC
    LIMIT 1
    `,
    [requestTypeId],
  );
  return rows[0] ?? null;
}

async function appendAction(input: {
  requestId: number;
  actorUserId: number | null;
  action: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  stepId?: number | null;
  stepOrder?: number | null;
  comment?: string | null;
  metadata?: unknown;
  scope?: { collegeId: number | null; branchId: number | null };
  ipAddress?: string | null;
}) {
  await executeAcademic(
    `
    INSERT INTO ap_request_actions
      (request_id, actor_user_id, action, from_status, to_status, step_id, step_order, comment, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.requestId,
      input.actorUserId,
      input.action,
      input.fromStatus,
      input.toStatus,
      input.stepId ?? null,
      input.stepOrder ?? null,
      input.comment ?? null,
      input.metadata == null ? null : JSON.stringify(input.metadata),
    ],
  );

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: `request.${input.action}`,
    entityType: "request",
    entityId: input.requestId,
    oldValue: { status: input.fromStatus, stepId: input.stepId ?? null },
    newValue: {
      status: input.toStatus,
      stepId: input.stepId ?? null,
      comment: input.comment ?? null,
      collegeId: input.scope?.collegeId ?? null,
      branchId: input.scope?.branchId ?? null,
      metadata: input.metadata ?? null,
    },
    ipAddress: input.ipAddress ?? null,
  });
}

function resolveRequesterScope(
  authz: AuthzContext,
  input: { collegeId?: number; branchId?: number },
) {
  if (authz.scope.isGlobal) {
    if (input.collegeId == null) fail(400, "collegeId is required");
    return {
      collegeId: input.collegeId,
      branchId: input.branchId ?? null,
    };
  }

  const collegeId =
    input.collegeId ??
    (authz.scope.collegeIds?.length === 1 ? authz.scope.collegeIds[0]! : undefined);
  if (collegeId == null) fail(400, "collegeId is required");

  const branchId = input.branchId ?? null;

  try {
    assertEntityInScope(authz, { collegeId, branchId });
  } catch {
    fail(403, "Forbidden for this academic scope");
  }

  return { collegeId, branchId };
}

export async function listRequestTypes() {
  const rows = await queryAcademic<RequestTypeRow[]>(
    `SELECT id, type_key, label, description FROM ap_request_types WHERE is_active = 1 ORDER BY label`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    typeKey: row.type_key,
    label: row.label,
    description: row.description,
  }));
}

export async function listPendingRequests(authz: AuthzContext) {
  return listRequests(authz, "pending");
}

export async function listRequests(
  authz: AuthzContext,
  filter: "mine" | "pending" | "all" = "mine",
) {
  if (!hasPermission(authz, "request.view")) fail(403, "Forbidden");

  const rows = await queryAcademic<RequestRow[]>(
    `
    SELECT
      r.*,
      rt.type_key,
      rt.label AS type_label,
      u.name AS requester_name,
      s.label AS current_step_label
    FROM ap_requests r
    INNER JOIN ap_request_types rt ON rt.id = r.request_type_id
    INNER JOIN ap_users u ON u.id = r.requester_user_id
    LEFT JOIN ap_request_workflow_steps s ON s.id = r.current_step_id
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT 500
    `,
  );

  const mapped = rows.map(mapRequest);
  let filtered = mapped;

  if (filter === "mine") {
    filtered = mapped.filter((row) => row.requesterUserId === authz.userId);
  } else if (filter === "pending") {
    if (!hasPermission(authz, "request.approve")) return [];
    const pending = mapped.filter((row) => row.status === "pending_approval");
    const eligible: typeof mapped = [];
    for (const request of pending) {
      if (!request.currentStepId) continue;
      const stepRows = await queryAcademic<StepRow[]>(
        `SELECT * FROM ap_request_workflow_steps WHERE id = ? LIMIT 1`,
        [request.currentStepId],
      );
      const step = stepRows[0] ? mapStep(stepRows[0]) : null;
      if (!step) continue;
      if (
        isEligibleApproverForStep(authz, step, {
          collegeId: request.collegeId,
          branchId: request.branchId,
        })
      ) {
        eligible.push(request);
      }
    }
    filtered = eligible;
  } else if (!(authz.scope.isGlobal || hasPermission(authz, "request.workflow.manage"))) {
    filtered = mapped.filter((request) => {
      try {
        assertEntityInScope(authz, {
          collegeId: request.collegeId,
          branchId: request.branchId,
        });
        return true;
      } catch {
        return request.requesterUserId === authz.userId;
      }
    });
  }

  const labels = await loadScopeLabels(filtered);
  const enriched = enrichRequests(filtered, labels);
  const substitutionIds = enriched
    .filter((row) => row.typeKey === SUBSTITUTION_TYPE_KEY)
    .map((row) => row.id);
  const substitutionMap = await loadSubstitutionSummariesForRequests(substitutionIds);
  return enriched.map((row) => ({
    ...row,
    substitution:
      row.typeKey === SUBSTITUTION_TYPE_KEY ? substitutionMap.get(row.id) ?? null : null,
  }));
}

export async function getRequestDetail(authz: AuthzContext, requestId: number) {
  const row = await loadRequestById(requestId);
  if (!row) return null;

  const request = mapRequest(row);
  const canView =
    request.requesterUserId === authz.userId ||
    hasPermission(authz, "request.workflow.manage") ||
    authz.scope.isGlobal;

  if (!canView) {
    try {
      assertEntityInScope(authz, {
        collegeId: request.collegeId,
        branchId: request.branchId,
      });
    } catch {
      if (request.status === "pending_approval" && request.currentStepId) {
        const stepRows = await queryAcademic<StepRow[]>(
          `SELECT * FROM ap_request_workflow_steps WHERE id = ? LIMIT 1`,
          [request.currentStepId],
        );
        const step = stepRows[0] ? mapStep(stepRows[0]) : null;
        if (
          !step ||
          !isEligibleApproverForStep(authz, step, {
            collegeId: request.collegeId,
            branchId: request.branchId,
          })
        ) {
          fail(403, "Forbidden");
        }
      } else {
        fail(403, "Forbidden");
      }
    }
  }

  const steps = await loadWorkflowSteps(request.workflowId);
  const currentStep = steps.find((step) => step.id === request.currentStepId) ?? null;
  const canApprove =
    request.status === "pending_approval" &&
    currentStep != null &&
    isEligibleApproverForStep(authz, currentStep, {
      collegeId: request.collegeId,
      branchId: request.branchId,
    });

  const actionRows = await queryAcademic<ActionRow[]>(
    `
    SELECT ra.*, u.name AS actor_name
    FROM ap_request_actions ra
    LEFT JOIN ap_users u ON u.id = ra.actor_user_id
    WHERE ra.request_id = ?
    ORDER BY ra.created_at ASC, ra.id ASC
    `,
    [requestId],
  );

  const [enrichedRequest] = enrichRequests([request], await loadScopeLabels([request]));

  const substitution =
    request.typeKey === SUBSTITUTION_TYPE_KEY
      ? await loadSubstitutionDetailByRequestId(requestId)
      : null;

  return {
    request: enrichedRequest,
    substitution,
    workflowSteps: steps,
    currentStep,
    canEdit: request.requesterUserId === authz.userId && ["draft", "returned"].includes(request.status),
    canSubmit: request.requesterUserId === authz.userId && ["draft", "returned"].includes(request.status),
    canApprove,
    canReject: canApprove,
    canReturn: canApprove,
    canEscalate: canApprove && Boolean(currentStep?.allowEscalate),
    canCancel:
      request.requesterUserId === authz.userId &&
      ["draft", "returned", "pending_approval"].includes(request.status),
    history: actionRows.map(mapAction),
  };
}

export async function createRequestDraft(
  authz: AuthzContext,
  input: {
    typeKey: string;
    title: string;
    body?: string;
    collegeId?: number;
    branchId?: number;
  },
  ipAddress?: string | null,
) {
  if (!hasPermission(authz, "request.create")) fail(403, "Forbidden");

  const typeRows = await queryAcademic<RequestTypeRow[]>(
    `SELECT * FROM ap_request_types WHERE type_key = ? AND is_active = 1 LIMIT 1`,
    [input.typeKey],
  );
  const type = typeRows[0];
  if (!type) fail(404, "Request type not found");

  const workflow = await loadActiveWorkflowForType(Number(type.id));
  if (!workflow) fail(400, "No active workflow configured for this request type");

  const scope = resolveRequesterScope(authz, {
    collegeId: input.collegeId,
    branchId: input.branchId,
  });

  const result = await executeAcademic(
    `
    INSERT INTO ap_requests
      (request_type_id, workflow_id, requester_user_id, college_id, branch_id, title, body, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
    `,
    [
      type.id,
      workflow.id,
      authz.userId,
      scope.collegeId,
      scope.branchId,
      input.title.trim(),
      input.body?.trim() || null,
    ],
  );

  const requestId = Number(result.insertId);
  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "created",
    fromStatus: null,
    toStatus: "draft",
    scope,
    ipAddress,
  });

  return getRequestDetail(authz, requestId);
}

export async function updateRequestDraft(
  authz: AuthzContext,
  requestId: number,
  input: { title?: string; body?: string },
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail) fail(404, "Request not found");
  if (!detail.canEdit) fail(403, "Forbidden");

  await executeAcademic(
    `UPDATE ap_requests SET title = COALESCE(?, title), body = COALESCE(?, body) WHERE id = ?`,
    [input.title?.trim() ?? null, input.body?.trim() ?? null, requestId],
  );

  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "draft_updated",
    fromStatus: detail.request.status,
    toStatus: detail.request.status,
    scope: {
      collegeId: detail.request.collegeId,
      branchId: detail.request.branchId,
    },
    ipAddress,
  });

  return getRequestDetail(authz, requestId);
}

async function activateStep(requestId: number, step: ReturnType<typeof mapStep>) {
  await executeAcademic(
    `
    UPDATE ap_requests
    SET status = 'pending_approval',
        current_step_id = ?,
        current_step_order = ?,
        submitted_at = COALESCE(submitted_at, NOW()),
        closed_at = NULL
    WHERE id = ?
    `,
    [step.id, step.stepOrder, requestId],
  );
}

export async function submitRequest(
  authz: AuthzContext,
  requestId: number,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail) fail(404, "Request not found");
  if (!detail.canSubmit) fail(403, "Forbidden");

  if (detail.request.typeKey === SUBSTITUTION_TYPE_KEY) {
    const substitution = await loadSubstitutionDetailByRequestId(requestId);
    if (!substitution) {
      fail(400, "Faculty substitution details are required before submitting this request");
    }
  }

  const steps = detail.workflowSteps;
  const firstStep = steps[0];
  if (!firstStep) fail(400, "Workflow has no approval steps");

  await executeAcademic(
    `UPDATE ap_requests SET status = 'submitted', submitted_at = NOW() WHERE id = ?`,
    [requestId],
  );
  const scope = {
    collegeId: detail.request.collegeId,
    branchId: detail.request.branchId,
  };

  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "submitted",
    fromStatus: detail.request.status,
    toStatus: "submitted",
    scope,
    ipAddress,
  });

  await activateStep(requestId, firstStep);
  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "pending_approval",
    fromStatus: "submitted",
    toStatus: "pending_approval",
    stepId: firstStep.id,
    stepOrder: firstStep.stepOrder,
    scope,
    metadata: { stepKey: firstStep.stepKey, stepLabel: firstStep.label },
    ipAddress,
  });

  return getRequestDetail(authz, requestId);
}

async function loadRequestTypeKey(requestId: number) {
  const rows = await queryAcademic<(RowDataPacket & { type_key: string })[]>(
    `
    SELECT rt.type_key
    FROM ap_requests r
    INNER JOIN ap_request_types rt ON rt.id = r.request_type_id
    WHERE r.id = ?
    LIMIT 1
    `,
    [requestId],
  );
  return rows[0]?.type_key ?? null;
}

async function auditSubstitutionLifecycle(
  requestId: number,
  action:
    | "faculty.substitution.approved"
    | "faculty.substitution.rejected"
    | "faculty.substitution.returned",
  actorUserId: number,
  ipAddress?: string | null,
) {
  const typeKey = await loadRequestTypeKey(requestId);
  if (typeKey !== SUBSTITUTION_TYPE_KEY) return;
  await writeAuditLog({
    actorUserId,
    action,
    entityType: "ap_request",
    entityId: requestId,
    ipAddress,
  });
}

async function finalizeApprovedRequest(
  requestId: number,
  authz: AuthzContext,
  ipAddress?: string | null,
) {
  const typeKey = await loadRequestTypeKey(requestId);
  if (typeKey !== SUBSTITUTION_TYPE_KEY) return;
  await applyFacultySubstitution(requestId, authz.userId, ipAddress);
}

async function advanceOrComplete(
  authz: AuthzContext,
  requestId: number,
  currentStep: ReturnType<typeof mapStep>,
  steps: ReturnType<typeof mapStep>[],
  action: "approved" | "escalated",
  comment: string | null,
  scope: { collegeId: number | null; branchId: number | null },
  ipAddress?: string | null,
) {
  if (currentStep.isFinal) {
    await finalizeApprovedRequest(requestId, authz, ipAddress);
    await executeAcademic(
      `UPDATE ap_requests SET status = 'approved', closed_at = NOW() WHERE id = ?`,
      [requestId],
    );
    await appendAction({
      requestId,
      actorUserId: authz.userId,
      action,
      fromStatus: "pending_approval",
      toStatus: "approved",
      stepId: currentStep.id,
      stepOrder: currentStep.stepOrder,
      comment,
      scope,
      ipAddress,
    });
    await auditSubstitutionLifecycle(
      requestId,
      "faculty.substitution.approved",
      authz.userId,
      ipAddress,
    );
    return;
  }

  const nextStep = steps.find((step) => step.stepOrder === currentStep.stepOrder + 1);
  if (!nextStep) {
    await finalizeApprovedRequest(requestId, authz, ipAddress);
    await executeAcademic(
      `UPDATE ap_requests SET status = 'approved', closed_at = NOW() WHERE id = ?`,
      [requestId],
    );
    await appendAction({
      requestId,
      actorUserId: authz.userId,
      action,
      fromStatus: "pending_approval",
      toStatus: "approved",
      stepId: currentStep.id,
      stepOrder: currentStep.stepOrder,
      comment,
      scope,
      ipAddress,
    });
    await auditSubstitutionLifecycle(
      requestId,
      "faculty.substitution.approved",
      authz.userId,
      ipAddress,
    );
    return;
  }

  await activateStep(requestId, nextStep);
  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action,
    fromStatus: "pending_approval",
    toStatus: "pending_approval",
    stepId: nextStep.id,
    stepOrder: nextStep.stepOrder,
    comment,
    scope,
    metadata: { previousStepId: currentStep.id, stepKey: nextStep.stepKey, stepLabel: nextStep.label },
    ipAddress,
  });
}

export async function approveRequest(
  authz: AuthzContext,
  requestId: number,
  comment?: string,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail?.canApprove || !detail.currentStep) fail(403, "Forbidden");

  const scope = {
    collegeId: detail.request.collegeId,
    branchId: detail.request.branchId,
  };

  await advanceOrComplete(
    authz,
    requestId,
    detail.currentStep,
    detail.workflowSteps,
    "approved",
    comment?.trim() || null,
    scope,
    ipAddress,
  );
  return getRequestDetail(authz, requestId);
}

export async function rejectRequest(
  authz: AuthzContext,
  requestId: number,
  comment?: string,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail?.canReject || !detail.currentStep) fail(403, "Forbidden");

  await executeAcademic(
    `UPDATE ap_requests SET status = 'rejected', closed_at = NOW(), current_step_id = NULL, current_step_order = NULL WHERE id = ?`,
    [requestId],
  );
  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "rejected",
    fromStatus: "pending_approval",
    toStatus: "rejected",
    stepId: detail.currentStep.id,
    stepOrder: detail.currentStep.stepOrder,
    comment: comment?.trim() || null,
    scope: {
      collegeId: detail.request.collegeId,
      branchId: detail.request.branchId,
    },
    ipAddress,
  });
  await auditSubstitutionLifecycle(
    requestId,
    "faculty.substitution.rejected",
    authz.userId,
    ipAddress,
  );
  return getRequestDetail(authz, requestId);
}

export async function returnRequest(
  authz: AuthzContext,
  requestId: number,
  comment?: string,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail?.canReturn || !detail.currentStep) fail(403, "Forbidden");
  if (!comment?.trim()) fail(400, "Comment is required when returning a request");

  await executeAcademic(
    `UPDATE ap_requests SET status = 'returned', current_step_id = NULL, current_step_order = NULL, closed_at = NULL WHERE id = ?`,
    [requestId],
  );
  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "returned",
    fromStatus: "pending_approval",
    toStatus: "returned",
    stepId: detail.currentStep.id,
    stepOrder: detail.currentStep.stepOrder,
    comment: comment.trim(),
    scope: {
      collegeId: detail.request.collegeId,
      branchId: detail.request.branchId,
    },
    ipAddress,
  });
  await auditSubstitutionLifecycle(
    requestId,
    "faculty.substitution.returned",
    authz.userId,
    ipAddress,
  );
  return getRequestDetail(authz, requestId);
}

export async function escalateRequest(
  authz: AuthzContext,
  requestId: number,
  comment?: string,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail?.canEscalate || !detail.currentStep) fail(403, "Forbidden");

  const scope = {
    collegeId: detail.request.collegeId,
    branchId: detail.request.branchId,
  };

  await advanceOrComplete(
    authz,
    requestId,
    detail.currentStep,
    detail.workflowSteps,
    "escalated",
    comment?.trim() || null,
    scope,
    ipAddress,
  );
  return getRequestDetail(authz, requestId);
}

export async function cancelRequest(
  authz: AuthzContext,
  requestId: number,
  comment?: string,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail?.canCancel) fail(403, "Forbidden");

  const fromStatus = detail.request.status;
  await executeAcademic(
    `UPDATE ap_requests SET status = 'cancelled', closed_at = NOW(), current_step_id = NULL, current_step_order = NULL WHERE id = ?`,
    [requestId],
  );
  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "cancelled",
    fromStatus,
    toStatus: "cancelled",
    stepId: detail.currentStep?.id ?? null,
    stepOrder: detail.currentStep?.stepOrder ?? null,
    comment: comment?.trim() || null,
    scope: {
      collegeId: detail.request.collegeId,
      branchId: detail.request.branchId,
    },
    ipAddress,
  });
  if (detail.request.typeKey === SUBSTITUTION_TYPE_KEY) {
    await markSubstitutionCancelled(requestId, authz.userId, ipAddress);
  }
  return getRequestDetail(authz, requestId);
}

export async function addRequestComment(
  authz: AuthzContext,
  requestId: number,
  comment: string,
  ipAddress?: string | null,
) {
  const detail = await getRequestDetail(authz, requestId);
  if (!detail) fail(404, "Request not found");
  if (!comment.trim()) fail(400, "Comment is required");

  await appendAction({
    requestId,
    actorUserId: authz.userId,
    action: "comment",
    fromStatus: detail.request.status,
    toStatus: detail.request.status,
    stepId: detail.currentStep?.id ?? null,
    stepOrder: detail.currentStep?.stepOrder ?? null,
    comment: comment.trim(),
    scope: {
      collegeId: detail.request.collegeId,
      branchId: detail.request.branchId,
    },
    ipAddress,
  });
  return getRequestDetail(authz, requestId);
}
