import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  getExaminationOverview,
  listCurriculum,
  listDepartments,
  listSubjects,
} from "../services/catalog.service.js";
import { getAcademicMasters, resolveBatchAcademicProgress } from "../services/masters.service.js";

export const catalogRouter = Router();

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

catalogRouter.get("/masters", requirePermission("catalog.view"), async (_req, res, next) => {
  try {
    res.json(await getAcademicMasters());
  } catch (error) {
    next(error);
  }
});

catalogRouter.get(
  "/batch-progress",
  requirePermission("catalog.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId = num(req.query.collegeId);
      const courseId = num(req.query.courseId);
      const branchId = num(req.query.branchId);
      const batch = str(req.query.batch);
      if (collegeId == null || courseId == null || branchId == null || !batch) {
        res.status(400).json({
          message: "collegeId, courseId, branchId, and batch are required",
        });
        return;
      }
      scopedFilters(req, { collegeId, branchId });
      const data = await resolveBatchAcademicProgress({
        collegeId,
        courseId,
        branchId,
        batch,
      });
      res.json({ data });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

catalogRouter.get("/departments", requirePermission("catalog.view"), async (_req, res, next) => {
  try {
    res.json({ data: await listDepartments() });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get("/subjects", requirePermission("catalog.view"), async (_req, res, next) => {
  try {
    res.json({ data: await listSubjects() });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get(
  "/curriculum",
  requirePermission("catalog.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedFilters(req, {
        collegeId: num(req.query.collegeId),
        branchId: num(req.query.branchId),
      });
      const data = await listCurriculum({
        collegeId: scoped.collegeId,
        courseId: num(req.query.courseId),
        branchId: scoped.branchId,
        batch: str(req.query.batch),
        year: num(req.query.year),
        semester: num(req.query.semester),
        section: str(req.query.section),
      });
      res.json(data);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

catalogRouter.get(
  "/examinations",
  requirePermission("catalog.view", "examinations.view"),
  async (_req, res, next) => {
    try {
      res.json(await getExaminationOverview());
    } catch (error) {
      next(error);
    }
  },
);
