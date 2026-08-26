import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  generateClassSessions,
  getClassSessionById,
  listClassSessions,
} from "../services/class-sessions.service.js";
import { getTimetablePlanScope } from "../services/timetables.service.js";

export const classSessionsRouter = Router();

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

classSessionsRouter.get(
  "/",
  requirePermission("attendance.view", "timetable.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedFilters(req, {
        collegeId: num(req.query.collegeId),
        branchId: num(req.query.branchId),
      });
      const data = await listClassSessions({
        planId: num(req.query.planId),
        date: str(req.query.date),
        startDate: str(req.query.startDate),
        endDate: str(req.query.endDate),
        facultyStaffLinkId: num(req.query.facultyStaffLinkId),
        section: str(req.query.section),
        branchId: scoped.branchId,
        branchIds: scoped.branchIds,
        collegeId: scoped.collegeId,
        collegeIds: scoped.collegeIds,
        status: str(req.query.status),
        limit: num(req.query.limit),
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

classSessionsRouter.post(
  "/generate",
  requirePermission("timetable.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as {
        publishedTimetablePlanId?: number;
        startDate?: string;
        endDate?: string;
      };
      if (!body.publishedTimetablePlanId) {
        res.status(400).json({
          message: "publishedTimetablePlanId is required",
        });
        return;
      }
      const planId = Number(body.publishedTimetablePlanId);
      const scope = await getTimetablePlanScope(planId);
      if (!scope) {
        res.status(404).json({ message: "Published timetable plan not found" });
        return;
      }
      ensureEntityScope(req, scope);
      const result = await generateClassSessions({
        publishedTimetablePlanId: planId,
        startDate: body.startDate,
        endDate: body.endDate,
      });
      res.status(201).json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      const message = (error as Error).message || "Failed to generate sessions";
      if (
        message.includes("only be generated from published") ||
        message.includes("endDate must") ||
        message.includes("Invalid date") ||
        message.includes("no timing template") ||
        message.includes("Semester dates not found") ||
        message.includes("missing year of study") ||
        message.includes("must both be provided")
      ) {
        res.status(400).json({ message });
        return;
      }
      if (message.includes("not found")) {
        res.status(404).json({ message });
        return;
      }
      next(error);
    }
  },
);

classSessionsRouter.get(
  "/:sessionId",
  requirePermission("attendance.view", "timetable.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const session = await getClassSessionById(Number(req.params.sessionId));
      if (!session) {
        res.status(404).json({ message: "Class session not found" });
        return;
      }
      ensureEntityScope(req, {
        collegeId: session.collegeId,
        branchId: session.branchId,
      });
      res.json(session);
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
