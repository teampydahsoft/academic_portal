import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  getFacultyWorkloadDetail,
  getWorkloadSummary,
} from "../services/workload.service.js";

export const workloadRouter = Router();

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

function filtersFromReq(req: AuthedRequest) {
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
    batch: str(req.query.batch),
    year: num(req.query.year),
    semester: num(req.query.semester),
    section: str(req.query.section),
    academicYear: str(req.query.academicYear),
  };
}

workloadRouter.get(
  "/summary",
  requirePermission("workload.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await getWorkloadSummary(filtersFromReq(req)));
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

workloadRouter.get(
  "/:facultyId",
  requirePermission("workload.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const facultyId = Array.isArray(req.params.facultyId)
        ? req.params.facultyId[0]
        : req.params.facultyId;
      const faculty = await getFacultyWorkloadDetail(String(facultyId), filtersFromReq(req));
      if (!faculty) {
        res.status(404).json({ message: "Faculty not found" });
        return;
      }
      res.json(faculty);
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
