import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import { getCommandCenterSummary } from "../services/command-center.service.js";

export const commandCenterRouter = Router();

commandCenterRouter.get(
  "/summary",
  requirePermission(
    "dashboard.view",
    "pending_exceptions.view",
    "reports.view",
    "alerts.view",
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedFilters(req, {
        collegeId: req.query.collegeId ? Number(req.query.collegeId) : undefined,
        branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      });
      const courseId = req.query.courseId ? Number(req.query.courseId) : undefined;
      const section =
        typeof req.query.section === "string" && req.query.section !== "all"
          ? req.query.section
          : undefined;

      const summary = await getCommandCenterSummary({
        collegeId: scoped.collegeId,
        collegeIds: scoped.collegeIds,
        courseId: Number.isFinite(courseId) ? courseId : undefined,
        branchId: scoped.branchId,
        branchIds: scoped.branchIds,
        section,
      });
      res.json(summary);
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
