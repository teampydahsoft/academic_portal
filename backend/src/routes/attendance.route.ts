import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  getAuthz,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  ownTeachingStaffLinkId,
  resolveStaffLinkIdForUser,
  shouldRestrictToOwnTeachingLoad,
} from "../authz/faculty-self-scope.js";
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
      const authz = getAuthz(req);
      const userStaffLinkId = await resolveStaffLinkIdForUser(authz.userId);
      const isStaffOnly = shouldRestrictToOwnTeachingLoad(authz);

      const scopeParam = str(req.query.scope);
      const isMineScope =
        isStaffOnly ||
        scopeParam === "mine" ||
        req.query.mine === "true" ||
        req.query.mine === "1";

      const facultyStaffLinkId = isMineScope ? (userStaffLinkId ?? -1) : undefined;
      const includeFacultyStaffLinkId =
        !isMineScope && userStaffLinkId != null ? userStaffLinkId : undefined;
      const generate =
        req.query.generate === "false" || req.query.generate === "0" ? false : true;
      res.json(
        await listAttendanceSessions({
          date: str(req.query.date),
          startDate: str(req.query.startDate),
          endDate: str(req.query.endDate),
          collegeId: isMineScope ? undefined : scoped.collegeId,
          collegeIds: isMineScope ? undefined : scoped.collegeIds,
          courseId: isMineScope ? undefined : num(req.query.courseId),
          branchId: isMineScope ? undefined : scoped.branchId,
          branchIds: isMineScope ? undefined : scoped.branchIds,
          batch: isMineScope ? undefined : str(req.query.batch),
          year: isMineScope ? undefined : num(req.query.year),
          semester: isMineScope ? undefined : num(req.query.semester),
          section: isMineScope ? undefined : str(req.query.section),
          academicYear: isMineScope ? undefined : str(req.query.academicYear),
          generate,
          ...(facultyStaffLinkId != null ? { facultyStaffLinkId } : {}),
          ...(includeFacultyStaffLinkId != null ? { includeFacultyStaffLinkId } : {}),
          currentStaffLinkId: userStaffLinkId,
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
  requirePermission("attendance_analytics.view", "attendance.view"),
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
      res.json(
        await getDailyAttendanceAnalytics({
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
      res.json(
        await getWeeklyAttendanceAnalytics({
          date: str(req.query.date),
          startDate: str(req.query.startDate),
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
      res.json(
        await getMonthlyAttendanceAnalytics({
          month: num(req.query.month),
          year: num(req.query.year),
          collegeId: scoped.collegeId,
          collegeIds: scoped.collegeIds,
          courseId: num(req.query.courseId),
          branchId: scoped.branchId,
          branchIds: scoped.branchIds,
          batch: str(req.query.batch),
          yearOfStudy: num(req.query.year),
          semester: num(req.query.semester),
          section: str(req.query.section),
          academicYear: str(req.query.academicYear),
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
      res.json(
        await getSemesterAttendanceAnalytics({
          semester: num(req.query.semester),
          academicYear: str(req.query.academicYear),
          collegeId: scoped.collegeId,
          collegeIds: scoped.collegeIds,
          courseId: num(req.query.courseId),
          branchId: scoped.branchId,
          branchIds: scoped.branchIds,
          batch: str(req.query.batch),
          yearOfStudy: num(req.query.year),
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
      const userStaffLinkId = await resolveStaffLinkIdForUser(req.authUser!.id);
      const isOwnClass =
        userStaffLinkId != null && Number(meta.facultyStaffLinkId) === userStaffLinkId;
      if (!isOwnClass) {
        ensureEntityScope(req, {
          collegeId: meta.collegeId,
          branchId: meta.branchId,
        });
      }
      const facultyStaffLinkId = await facultyFilter(req);
      if (
        !isOwnClass &&
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
      const authz = getAuthz(req);
      const isSuperAdminOnly =
        authz.roles.some((r) => r.roleKey === "super_admin") &&
        !authz.roles.some((r) => r.roleKey !== "super_admin");
      if (isSuperAdminOnly) {
        res.status(403).json({
          message:
            "Super administrators have oversight access only. Attendance must be marked and submitted by assigned faculty or academic leadership (HOD, Vice Principal, Principal).",
        });
        return;
      }
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
      const userStaffLinkId = await resolveStaffLinkIdForUser(req.authUser!.id);
      const isOwnClass =
        userStaffLinkId != null && Number(meta.facultyStaffLinkId) === userStaffLinkId;
      if (!isOwnClass) {
        ensureEntityScope(req, {
          collegeId: meta.collegeId,
          branchId: meta.branchId,
        });
      }
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
        requiredFacultyStaffLinkId: !isOwnClass ? (facultyStaffLinkId ?? undefined) : undefined,
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
