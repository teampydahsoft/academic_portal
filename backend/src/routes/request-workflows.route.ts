import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  getAuthz,
  requirePermission,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  createRequestType,
  createWorkflow,
  getWorkflowAdmin,
  listApproverRoles,
  listRequestTypesAdmin,
  saveWorkflowSteps,
  updateRequestType,
  updateWorkflow,
} from "../services/request-workflow-admin.service.js";
import type { ScopeMode } from "../services/request-workflow.service.js";

export const requestWorkflowsRouter = Router();

function num(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

const SCOPE_MODES = new Set([
  "requester_scope",
  "same_college",
  "same_branch",
  "global",
]);

function parseSteps(raw: unknown) {
  if (!Array.isArray(raw)) return { ok: false as const, message: "steps must be a JSON array" };
  if (raw.length === 0) {
    return { ok: false as const, message: "At least one approval step is required" };
  }

  const steps: NonNullable<ReturnType<typeof parseStepObject>>[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const parsed = parseStepObject(raw[index]);
    if (!parsed) {
      return {
        ok: false as const,
        message: `Step ${index + 1} is invalid: label, approverRoleKey, and scopeMode are required`,
      };
    }
    steps.push(parsed);
  }
  return { ok: true as const, steps };
}

function parseStepObject(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const step = item as Record<string, unknown>;
  const scopeMode = str(step.scopeMode);
  if (!scopeMode || !SCOPE_MODES.has(scopeMode)) return null;
  const label = str(step.label);
  const approverRoleKey = str(step.approverRoleKey);
  if (!label || !approverRoleKey) return null;
  return {
    id: num(step.id) ?? null,
    stepKey: str(step.stepKey),
    label,
    approverRoleKey,
    requiredPermission: str(step.requiredPermission),
    scopeMode: scopeMode as ScopeMode,
    allowEscalate: Boolean(step.allowEscalate),
    isFinal: Boolean(step.isFinal),
  };
}

function handleError(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  const status = statusFromAuthzError(error);
  if (status >= 400 && status < 500) {
    res.status(status).json({ message: (error as Error).message || "Request failed" });
    return;
  }
  next(error);
}

requestWorkflowsRouter.get(
  "/approver-roles",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json({ data: await listApproverRoles(getAuthz(req)) });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.get(
  "/types",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json({ data: await listRequestTypesAdmin(getAuthz(req)) });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.post(
  "/types",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const typeKey = str(req.body?.typeKey);
      const label = str(req.body?.label);
      if (!typeKey || !label) {
        res.status(400).json({ message: "typeKey and label are required" });
        return;
      }
      const created = await createRequestType(
        getAuthz(req),
        {
          typeKey,
          label,
          description: str(req.body?.description) ?? null,
          isActive: req.body?.isActive !== false,
        },
        req.ip,
      );
      res.status(201).json(created);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.patch(
  "/types/:typeId",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const typeId = num(req.params.typeId);
      if (!typeId) {
        res.status(400).json({ message: "Invalid type id" });
        return;
      }
      const updated = await updateRequestType(
        getAuthz(req),
        typeId,
        {
          label: str(req.body?.label),
          description:
            req.body?.description === null
              ? null
              : str(req.body?.description) ?? undefined,
          isActive:
            typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
        },
        req.ip,
      );
      res.json(updated);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.post(
  "/types/:typeId/workflows",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const typeId = num(req.params.typeId);
      const label = str(req.body?.label);
      if (!typeId || !label) {
        res.status(400).json({ message: "typeId and label are required" });
        return;
      }
      const created = await createWorkflow(
        getAuthz(req),
        typeId,
        {
          workflowKey: str(req.body?.workflowKey),
          label,
          isActive: req.body?.isActive !== false,
        },
        req.ip,
      );
      res.status(201).json(created);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.get(
  "/workflows/:workflowId",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workflowId = num(req.params.workflowId);
      if (!workflowId) {
        res.status(400).json({ message: "Invalid workflow id" });
        return;
      }
      res.json(await getWorkflowAdmin(getAuthz(req), workflowId));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.patch(
  "/workflows/:workflowId",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workflowId = num(req.params.workflowId);
      if (!workflowId) {
        res.status(400).json({ message: "Invalid workflow id" });
        return;
      }
      const updated = await updateWorkflow(
        getAuthz(req),
        workflowId,
        {
          label: str(req.body?.label),
          isActive:
            typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
        },
        req.ip,
      );
      res.json(updated);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

requestWorkflowsRouter.put(
  "/workflows/:workflowId/steps",
  requirePermission("request.workflow.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workflowId = num(req.params.workflowId);
      if (!workflowId) {
        res.status(400).json({ message: "Invalid workflow id" });
        return;
      }
      const parsed = parseSteps(req.body?.steps);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      const saved = await saveWorkflowSteps(
        getAuthz(req),
        workflowId,
        parsed.steps,
        req.ip,
      );
      res.json(saved);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);
