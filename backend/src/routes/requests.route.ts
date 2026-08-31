import { Router, type NextFunction, type Response } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  getAuthz,
  requirePermission,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  addRequestComment,
  approveRequest,
  cancelRequest,
  createRequestDraft,
  escalateRequest,
  getRequestDetail,
  listRequestTypes,
  listPendingRequests,
  listRequests,
  rejectRequest,
  returnRequest,
  submitRequest,
  updateRequestDraft,
} from "../services/request-workflow.service.js";
import {
  createSubstitutionDetails,
  SUBSTITUTION_TYPE_KEY,
} from "../services/faculty-substitution.service.js";

export const requestsRouter = Router();

function num(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function requestIdFromParams(req: AuthedRequest) {
  return Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
}

async function actionHandler(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
  handler: (
    authz: ReturnType<typeof getAuthz>,
    requestId: number,
    comment?: string,
    ip?: string,
  ) => Promise<unknown>,
) {
  try {
    const requestId = requestIdFromParams(req);
    const comment = str(req.body?.comment);
    const detail = await handler(getAuthz(req), requestId, comment, req.ip);
    res.json(detail);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message || "Request failed" });
      return;
    }
    next(error);
  }
}

requestsRouter.get("/types", requirePermission("request.view"), async (_req, res, next) => {
  try {
    res.json({ data: await listRequestTypes() });
  } catch (error) {
    next(error);
  }
});

requestsRouter.get("/pending", requirePermission("request.view"), async (req: AuthedRequest, res, next) => {
  try {
    res.json({ data: await listPendingRequests(getAuthz(req)) });
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

requestsRouter.get("/", requirePermission("request.view"), async (req: AuthedRequest, res, next) => {
  try {
    const filter = str(req.query.filter);
    const mode =
      filter === "pending" ? "pending" : filter === "all" ? "all" : "mine";
    res.json({ data: await listRequests(getAuthz(req), mode) });
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

requestsRouter.post("/", requirePermission("request.create"), async (req: AuthedRequest, res, next) => {
  try {
    const typeKey = str(req.body?.typeKey);
    const title = str(req.body?.title);
    if (!typeKey) {
      res.status(400).json({ message: "typeKey is required" });
      return;
    }

    const substitution = req.body?.substitution;
    const resolvedTitle =
      title ??
      (typeKey === SUBSTITUTION_TYPE_KEY && substitution?.sessionDate
        ? `Faculty substitution — ${String(substitution.sessionDate)}`
        : undefined);

    if (!resolvedTitle) {
      res.status(400).json({ message: "typeKey and title are required" });
      return;
    }

    const detail = await createRequestDraft(
      getAuthz(req),
      {
        typeKey,
        title: resolvedTitle,
        body: str(req.body?.body),
        collegeId: num(req.body?.collegeId),
        branchId: num(req.body?.branchId),
      },
      req.ip,
    );

    if (typeKey === SUBSTITUTION_TYPE_KEY && substitution && typeof substitution === "object") {
      const sub = substitution as Record<string, unknown>;
      await createSubstitutionDetails(
        getAuthz(req),
        detail.request.id,
        {
          sessionDate: String(sub.sessionDate ?? ""),
          timetableEntryId: Number(sub.timetableEntryId),
          replacementFacultyStaffLinkId: Number(sub.replacementFacultyStaffLinkId),
          reason: String(sub.reason ?? ""),
          collegeId: Number(sub.collegeId),
          courseId: Number(sub.courseId),
          branchId: Number(sub.branchId),
          batch: String(sub.batch ?? ""),
          yearOfStudy: num(sub.yearOfStudy),
          semesterNumber: num(sub.semesterNumber),
          sectionName: String(sub.sectionName ?? ""),
          timingSlotId: Number(sub.timingSlotId),
          academicYear: str(sub.academicYear),
        },
        req.ip,
      );
      const refreshed = await getRequestDetail(getAuthz(req), detail.request.id);
      res.status(201).json(refreshed);
      return;
    }

    res.status(201).json(detail);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message || "Request failed" });
      return;
    }
    next(error);
  }
});

requestsRouter.get("/:id", requirePermission("request.view"), async (req: AuthedRequest, res, next) => {
  try {
    const detail = await getRequestDetail(getAuthz(req), requestIdFromParams(req));
    if (!detail) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    res.json(detail);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message || "Request failed" });
      return;
    }
    next(error);
  }
});

requestsRouter.put("/:id", requirePermission("request.create"), async (req: AuthedRequest, res, next) => {
  try {
    const detail = await updateRequestDraft(
      getAuthz(req),
      requestIdFromParams(req),
      { title: str(req.body?.title), body: str(req.body?.body) },
      req.ip,
    );
    res.json(detail);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message || "Request failed" });
      return;
    }
    next(error);
  }
});

requestsRouter.post("/:id/submit", requirePermission("request.create"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, _c, ip) => submitRequest(authz, id, ip)),
);

requestsRouter.post("/:id/approve", requirePermission("request.approve"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, comment, ip) => approveRequest(authz, id, comment, ip)),
);

requestsRouter.post("/:id/reject", requirePermission("request.approve"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, comment, ip) => rejectRequest(authz, id, comment, ip)),
);

requestsRouter.post("/:id/return", requirePermission("request.approve"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, comment, ip) => returnRequest(authz, id, comment, ip)),
);

requestsRouter.post("/:id/escalate", requirePermission("request.approve"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, comment, ip) => escalateRequest(authz, id, comment, ip)),
);

requestsRouter.post("/:id/cancel", requirePermission("request.create"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, comment, ip) => cancelRequest(authz, id, comment, ip)),
);

requestsRouter.post("/:id/comments", requirePermission("request.view"), (req, res, next) =>
  actionHandler(req, res, next, (authz, id, comment, ip) =>
    addRequestComment(authz, id, comment ?? "", ip),
  ),
);
