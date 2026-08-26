import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  getSemesterDatesGrid,
  listSemesterDateBatches,
  upsertSemesterDates,
} from "../services/semester-dates.service.js";

export const semesterDatesRouter = Router();

function requiredNumber(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  return n;
}

semesterDatesRouter.get(
  "/batches",
  requirePermission("semester_dates.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId = requiredNumber(req.query.collegeId, "collegeId");
      scopedFilters(req, { collegeId });
      const courseId = requiredNumber(req.query.courseId, "courseId");
      const batches = await listSemesterDateBatches(collegeId, courseId);
      res.json({ data: batches });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 400 || status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

semesterDatesRouter.get(
  "/",
  requirePermission("semester_dates.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId = requiredNumber(req.query.collegeId, "collegeId");
      scopedFilters(req, { collegeId });
      const courseId = requiredNumber(req.query.courseId, "courseId");
      const batch = typeof req.query.batch === "string" ? req.query.batch.trim() : "";
      if (!batch) throw Object.assign(new Error("batch is required"), { status: 400 });
      const grid = await getSemesterDatesGrid({ collegeId, courseId, batch });
      res.json(grid);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 400 || status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

semesterDatesRouter.put(
  "/",
  requirePermission("semester_dates.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const collegeId = requiredNumber(body.collegeId, "collegeId");
      scopedFilters(req, { collegeId });
      const result = await upsertSemesterDates({
        collegeId,
        courseId: requiredNumber(body.courseId, "courseId"),
        batch: String(body.batch ?? "").trim(),
        yearOfStudy: requiredNumber(body.yearOfStudy, "yearOfStudy"),
        semesterNumber: requiredNumber(body.semesterNumber, "semesterNumber"),
        startDate:
          typeof body.startDate === "string" && body.startDate.trim()
            ? body.startDate.trim()
            : null,
        endDate:
          typeof body.endDate === "string" && body.endDate.trim()
            ? body.endDate.trim()
            : null,
      });
      if (!String(body.batch ?? "").trim()) {
        throw Object.assign(new Error("batch is required"), { status: 400 });
      }
      res.json({ data: result });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 400 || status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);
