import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  getAttendanceAnalytics,
  getAttendanceSession,
  listAttendanceSessions,
  postAttendance,
  type AttendanceMark,
} from "../services/attendance.service.js";
import { getClassSessionById } from "../services/class-sessions.service.js";
import { writeAuditLog } from "../services/audit.service.js";

export const attendanceRouter = Router();

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

function statusFromError(error: unknown) {
  return Number((error as { status?: number }).status) || 500;
}

function scopedQuery(req: AuthedRequest) {
  return scopedFilters(req, {
    collegeId: num(req.query.collegeId),
    branchId: num(req.query.branchId),
  });
}

attendanceRouter.get(
  "/sessions",
  requirePermission("attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const generate =
        req.query.generate === "false" || req.query.generate === "0" ? false : true;
      res.json(
        await listAttendanceSessions({
          date: str(req.query.date),
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
          generate,
        }),
      );
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

attendanceRouter.get(
  "/today",
  requirePermission("attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const payload = await listAttendanceSessions({
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
      });
      res.json(payload);
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

attendanceRouter.get(
  "/analytics",
  requirePermission("attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      res.json(
        await getAttendanceAnalytics({
          collegeId: scoped.collegeId,
          collegeIds: scoped.collegeIds,
          courseId: num(req.query.courseId),
          branchId: scoped.branchId,
          branchIds: scoped.branchIds,
          section: str(req.query.section),
        }),
      );
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

attendanceRouter.get(
  "/sessions/:sessionId",
  requirePermission("attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId)) {
        res.status(400).json({ message: "Invalid class session id" });
        return;
      }
      const meta = await getClassSessionById(sessionId);
      if (!meta) {
        res.status(404).json({ message: "Class session not found" });
        return;
      }
      ensureEntityScope(req, {
        collegeId: meta.collegeId,
        branchId: meta.branchId,
      });
      res.json(await getAttendanceSession(sessionId));
    } catch (error) {
      const status = statusFromError(error);
      if (status === 400 || status === 403 || status === 404 || status === 401) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

attendanceRouter.post(
  "/sessions/:sessionId",
  requirePermission("attendance.post"),
  async (req: AuthedRequest, res, next) => {
    try {
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId)) {
        res.status(400).json({ message: "Invalid class session id" });
        return;
      }
      const meta = await getClassSessionById(sessionId);
      if (!meta) {
        res.status(404).json({ message: "Class session not found" });
        return;
      }
      ensureEntityScope(req, {
        collegeId: meta.collegeId,
        branchId: meta.branchId,
      });
      const body = req.body as {
        students?: Array<{
          studentDbId: number;
          admissionNumber?: string;
          status: AttendanceMark;
          remarks?: string | null;
        }>;
        editReason?: string | null;
      };
      const isEdit = Boolean(body.editReason?.trim());
      const result = await postAttendance(sessionId, {
        students: body.students ?? [],
        editReason: body.editReason,
        postedByUserId: req.authUser!.id,
      });
      await writeAuditLog({
        actorUserId: req.authUser!.id,
        action: isEdit ? "attendance.edited" : "attendance.posted",
        entityType: "ap_attendance_posts",
        entityId: Number(result.postId),
        newValue: {
          classSessionId: sessionId,
          present: result.present,
          absent: result.absent,
          od: result.od,
          leave: result.leave,
          total: result.total,
          editReason: isEdit ? "[provided]" : null,
        },
        ipAddress: req.ip,
      });
      res.status(201).json(result);
    } catch (error) {
      const status = statusFromError(error);
      if (status === 400 || status === 403 || status === 404 || status === 409 || status === 401) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);
