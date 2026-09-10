import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  copyTimetablePlan,
  getTimetablePlanScope,
  getTimetablePlanner,
  getTimetableVersions,
  getTimingTemplateForFilters,
  listFacultyOptions,
  listSubjectsForPlanner,
  listTimetableReportRows,
  listTimetableSections,
  publishTimetablePlan,
  reviewTimetablePlan,
  saveTimetableDraft,
} from "../services/timetables.service.js";
import {
  getTimingTemplateDetail,
  upsertTimingTemplate,
} from "../services/timing.service.js";
import { writeAuditLog } from "../services/audit.service.js";

export const timetablesRouter = Router();

function num(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (value === "" || value === "all") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown) {
  if (typeof value !== "string" || value === "" || value === "all") return undefined;
  return value;
}

function filtersFromQuery(req: AuthedRequest) {
  const scoped = scopedFilters(req, {
    collegeId: num(req.query.collegeId),
    branchId: num(req.query.branchId),
  });
  return {
    collegeId: scoped.collegeId,
    collegeIds: scoped.collegeIds,
    courseId: num(req.query.courseId),
    branchId: scoped.branchId,
    branchIds: scoped.branchIds,
    section: str(req.query.section),
    batch: str(req.query.batch),
    year: num(req.query.year),
    semester: num(req.query.semester),
    academicYear: str(req.query.academicYear),
  };
}

function sendAuthzError(res: import("express").Response, error: unknown, next: import("express").NextFunction) {
  const status = statusFromAuthzError(error);
  if (status === 401 || status === 403) {
    res.status(status).json({ message: (error as Error).message || "Forbidden" });
    return;
  }
  next(error);
}

async function assertPlanInScope(req: AuthedRequest, planId: number) {
  const scope = await getTimetablePlanScope(planId);
  if (!scope) {
    throw Object.assign(new Error("Plan not found"), { status: 404 });
  }
  ensureEntityScope(req, scope);
}

timetablesRouter.get("/sections", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    res.json({ data: await listTimetableSections(filtersFromQuery(req)) });
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.get("/timing", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    const timing = await getTimingTemplateForFilters(filtersFromQuery(req));
    res.json({ timing });
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.get("/timing/:templateId", requirePermission("timetable.view"), async (req, res, next) => {
  try {
    const detail = await getTimingTemplateDetail(Number(req.params.templateId));
    if (!detail) {
      res.status(404).json({ message: "Timing template not found" });
      return;
    }
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

timetablesRouter.post("/timing", requirePermission("timetable.edit"), async (req: AuthedRequest, res, next) => {
  try {
    scopedFilters(req, {
      collegeId: num(req.body?.collegeId),
      branchId: num(req.body?.branchId),
    });
    const created = await upsertTimingTemplate(req.body);
    res.status(201).json(created);
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.get("/planner", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await getTimetablePlanner(filtersFromQuery(req)));
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.get("/report", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    res.json({ data: await listTimetableReportRows(filtersFromQuery(req)) });
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.get("/subjects", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    res.json({ data: await listSubjectsForPlanner(filtersFromQuery(req)) });
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.get("/faculty", requirePermission("timetable.view", "faculty.view"), async (_req, res, next) => {
  try {
    res.json({ data: await listFacultyOptions() });
  } catch (error) {
    next(error);
  }
});

timetablesRouter.post("/draft", requirePermission("timetable.edit"), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body as {
      collegeId: number;
      courseId: number;
      branchId: number;
      academicYear: string;
      batch: string;
      year?: number | null;
      semester: number;
      section?: string | null;
      notes?: string | null;
      assignments: unknown[];
    };
    scopedFilters(req, {
      collegeId: Number(body.collegeId),
      branchId: Number(body.branchId),
    });
    const result = await saveTimetableDraft({
      ...body,
      assignments: (body.assignments ?? []) as never[],
      actorUserId: req.authUser?.id,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.put("/draft/:planId", requirePermission("timetable.edit"), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body as {
      collegeId: number;
      courseId: number;
      branchId: number;
      academicYear: string;
      batch: string;
      year?: number | null;
      semester: number;
      section?: string | null;
      notes?: string | null;
      assignments: unknown[];
    };
    scopedFilters(req, {
      collegeId: Number(body.collegeId),
      branchId: Number(body.branchId),
    });
    const result = await saveTimetableDraft({
      ...body,
      assignments: (body.assignments ?? []) as never[],
      actorUserId: req.authUser?.id,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});

timetablesRouter.post("/:planId/review", requirePermission("timetable.edit"), async (req: AuthedRequest, res, next) => {
  try {
    await assertPlanInScope(req, Number(req.params.planId));
    res.json(await reviewTimetablePlan(Number(req.params.planId)));
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403 || status === 404) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

timetablesRouter.post("/:planId/publish", requirePermission("timetable.publish"), async (req: AuthedRequest, res, next) => {
  try {
    await assertPlanInScope(req, Number(req.params.planId));
    const published = await publishTimetablePlan(Number(req.params.planId), {
      actorUserId: req.authUser?.id,
      ipAddress: req.ip,
    });
    await writeAuditLog({
      actorUserId: req.authUser!.id,
      action: "timetable.published",
      entityType: "ap_timetable_plans",
      entityId: Number(req.params.planId),
      newValue: { status: "published" },
      ipAddress: req.ip,
    });
    res.json(published);
  } catch (error) {
    const err = error as Error & { review?: unknown; status?: number };
    if (err.review) {
      res.status(400).json({ message: err.message, review: err.review });
      return;
    }
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403 || status === 404) {
      res.status(status).json({ message: err.message || "Forbidden" });
      return;
    }
    next(error);
  }
});

timetablesRouter.get("/:planId/versions", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    await assertPlanInScope(req, Number(req.params.planId));
    res.json({ data: await getTimetableVersions(Number(req.params.planId)) });
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403 || status === 404) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

timetablesRouter.post("/copy", requirePermission("timetable.edit"), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body as {
      sourcePlanId: number;
      target: {
        collegeId: number;
        courseId: number;
        branchId: number;
        academicYear: string;
        batch: string;
        year?: number | null;
        semester: number;
        section?: string | null;
      };
    };
    await assertPlanInScope(req, Number(body.sourcePlanId));
    scopedFilters(req, {
      collegeId: Number(body.target.collegeId),
      branchId: Number(body.target.branchId),
    });
    res.json(await copyTimetablePlan({
      ...body,
      actorUserId: req.authUser?.id,
      ipAddress: req.ip,
    }));
  } catch (error) {
    sendAuthzError(res, error, next);
  }
});
