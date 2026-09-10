import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  getAuthz,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import { ownTeachingStaffLinkId } from "../authz/faculty-self-scope.js";
import {
  getAttendanceAnalytics,
  getAttendanceSession,
  getDailyAttendanceAnalytics,
  getWeeklyAttendanceAnalytics,
  getMonthlyAttendanceAnalytics,
  getSemesterAttendanceAnalytics,
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

async function facultyFilter(req: AuthedRequest) {
  const authz = getAuthz(req);
  const staffLinkId = await ownTeachingStaffLinkId(authz);
  return staffLinkId === undefined ? undefined : staffLinkId ?? -1;
}

attendanceRouter.get(
  "/sessions",
  requirePermission("attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const facultyStaffLinkId = await facultyFilter(req);
      const isStaff = facultyStaffLinkId != null;
      const generate =
        req.query.generate === "false" || req.query.generate === "0" ? false : true;
      res.json(
        await listAttendanceSessions({
          date: str(req.query.date),
          collegeId: isStaff ? undefined : scoped.collegeId,
          collegeIds: isStaff ? undefined : scoped.collegeIds,
          courseId: isStaff ? undefined : num(req.query.courseId),
          branchId: isStaff ? undefined : scoped.branchId,
          branchIds: isStaff ? undefined : scoped.branchIds,
          batch: isStaff ? undefined : str(req.query.batch),
          year: isStaff ? undefined : num(req.query.year),
          semester: isStaff ? undefined : num(req.query.semester),
          section: isStaff ? undefined : str(req.query.section),
          academicYear: isStaff ? undefined : str(req.query.academicYear),
          generate,
          ...(facultyStaffLinkId != null ? { facultyStaffLinkId } : {}),
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
      const facultyStaffLinkId = await facultyFilter(req);
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
        ...(facultyStaffLinkId != null ? { facultyStaffLinkId } : {}),
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
  requirePermission("attendance_analytics.view"),
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
  "/analytics/daily",
  requirePermission("attendance_analytics.view", "attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const facultyStaffLinkId = await facultyFilter(req);
      const isStaff = facultyStaffLinkId != null;
      res.json(
        await getDailyAttendanceAnalytics({
          date: str(req.query.date),
          collegeId: isStaff ? undefined : scoped.collegeId,
          collegeIds: isStaff ? undefined : scoped.collegeIds,
          courseId: isStaff ? undefined : num(req.query.courseId),
          branchId: isStaff ? undefined : scoped.branchId,
          branchIds: isStaff ? undefined : scoped.branchIds,
          batch: isStaff ? undefined : str(req.query.batch),
          year: isStaff ? undefined : num(req.query.year),
          semester: isStaff ? undefined : num(req.query.semester),
          section: isStaff ? undefined : str(req.query.section),
          academicYear: isStaff ? undefined : str(req.query.academicYear),
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
  "/analytics/week",
  requirePermission("attendance_analytics.view", "attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const facultyStaffLinkId = await facultyFilter(req);
      const isStaff = facultyStaffLinkId != null;
      res.json(
        await getWeeklyAttendanceAnalytics({
          date: str(req.query.date),
          startDate: str(req.query.startDate),
          collegeId: isStaff ? undefined : scoped.collegeId,
          collegeIds: isStaff ? undefined : scoped.collegeIds,
          courseId: isStaff ? undefined : num(req.query.courseId),
          branchId: isStaff ? undefined : scoped.branchId,
          branchIds: isStaff ? undefined : scoped.branchIds,
          batch: isStaff ? undefined : str(req.query.batch),
          year: isStaff ? undefined : num(req.query.year),
          semester: isStaff ? undefined : num(req.query.semester),
          section: isStaff ? undefined : str(req.query.section),
          academicYear: isStaff ? undefined : str(req.query.academicYear),
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
  "/analytics/monthly",
  requirePermission("attendance_analytics.view", "attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const facultyStaffLinkId = await facultyFilter(req);
      const isStaff = facultyStaffLinkId != null;
      res.json(
        await getMonthlyAttendanceAnalytics({
          month: num(req.query.month),
          year: num(req.query.year),
          collegeId: isStaff ? undefined : scoped.collegeId,
          collegeIds: isStaff ? undefined : scoped.collegeIds,
          courseId: isStaff ? undefined : num(req.query.courseId),
          branchId: isStaff ? undefined : scoped.branchId,
          branchIds: isStaff ? undefined : scoped.branchIds,
          batch: isStaff ? undefined : str(req.query.batch),
          yearOfStudy: isStaff ? undefined : num(req.query.year),
          semester: isStaff ? undefined : num(req.query.semester),
          section: isStaff ? undefined : str(req.query.section),
          academicYear: isStaff ? undefined : str(req.query.academicYear),
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
  "/analytics/semester",
  requirePermission("attendance_analytics.view", "attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = scopedQuery(req);
      const facultyStaffLinkId = await facultyFilter(req);
      const isStaff = facultyStaffLinkId != null;
      res.json(
        await getSemesterAttendanceAnalytics({
          semester: num(req.query.semester),
          academicYear: str(req.query.academicYear),
          collegeId: isStaff ? undefined : scoped.collegeId,
          collegeIds: isStaff ? undefined : scoped.collegeIds,
          courseId: isStaff ? undefined : num(req.query.courseId),
          branchId: isStaff ? undefined : scoped.branchId,
          branchIds: isStaff ? undefined : scoped.branchIds,
          batch: isStaff ? undefined : str(req.query.batch),
          yearOfStudy: isStaff ? undefined : num(req.query.year),
          section: isStaff ? undefined : str(req.query.section),
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
      const facultyStaffLinkId = await facultyFilter(req);
      if (
        facultyStaffLinkId != null &&
        Number(meta.facultyStaffLinkId) !== facultyStaffLinkId
      ) {
        res.status(403).json({ message: "You can only view attendance for your own assigned classes" });
        return;
      }
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
      const facultyStaffLinkId = await facultyFilter(req);
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
        requiredFacultyStaffLinkId: facultyStaffLinkId ?? undefined,
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
