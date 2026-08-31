import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import { getMyTimetable } from "../services/my-timetable.service.js";

export const myTimetableRouter = Router();

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

myTimetableRouter.get(
  "/",
  requirePermission("timetable.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const hrmsEmployeeId = req.authUser?.hrmsEmployeeId ?? null;
      res.json(await getMyTimetable(hrmsEmployeeId, filtersFromReq(req)));
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
