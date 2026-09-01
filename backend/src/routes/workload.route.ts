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

function str(value: unknown) {
  if (typeof value !== "string" || value === "" || value === "all") return undefined;
  return value;
}

function summaryFiltersFromReq(req: AuthedRequest) {
  const scoped = scopedFilters(req, {});
  return {
    collegeId: scoped.collegeId,
    collegeIds: scoped.collegeIds,
    branchId: scoped.branchId,
    branchIds: scoped.branchIds,
    scopeOnly: true,
    division: str(req.query.division),
    department: str(req.query.department),
    search: str(req.query.search),
  };
}

workloadRouter.get(
  "/summary",
  requirePermission("workload.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await getWorkloadSummary(summaryFiltersFromReq(req)));
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
      const scoped = scopedFilters(req, {});
      const faculty = await getFacultyWorkloadDetail(String(facultyId), {
        collegeId: scoped.collegeId,
        collegeIds: scoped.collegeIds,
        branchId: scoped.branchId,
        branchIds: scoped.branchIds,
        scopeOnly: true,
      });
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
