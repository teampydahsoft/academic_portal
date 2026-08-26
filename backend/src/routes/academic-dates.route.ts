import { Router, type NextFunction, type Response } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  assertCollegeNamesInScope,
  allowedCollegeNames,
} from "../authz/academic-entity-scope.js";
import {
  getAuthz,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  createCustomHoliday,
  estimateHolidayRecipients,
  getAttendanceCalendar,
  getMonthAttendanceCalendar,
  listHolidayTargetOptions,
  updateCustomHoliday,
} from "../services/attendance-calendar.service.js";
import {
  listCustomHolidays,
  resolveSemesterWindow,
} from "../services/student-academic-dates.service.js";
import { writeAuditLog } from "../services/audit.service.js";

export const academicDatesRouter = Router();

function requiredNumber(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  return n;
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "" || value === "all") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

academicDatesRouter.get(
  "/window",
  requirePermission("attendance_calendar.view", "semester_dates.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId = requiredNumber(req.query.collegeId, "collegeId");
      scopedFilters(req, { collegeId });
      const window = await resolveSemesterWindow({
        collegeId,
        courseId: requiredNumber(req.query.courseId, "courseId"),
        batch: optionalString(req.query.batch) ?? null,
        yearOfStudy: requiredNumber(req.query.yearOfStudy, "yearOfStudy"),
        semesterNumber: requiredNumber(req.query.semesterNumber, "semesterNumber"),
      });
      if (!window) {
        res.status(404).json({
          message: "Semester dates not found in Student Database for this scope",
          source: "student_database.semesters",
        });
        return;
      }
      res.json(window);
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

academicDatesRouter.get(
  "/holidays",
  requirePermission("attendance_calendar.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId = optionalNumber(req.query.collegeId);
      const courseId = optionalNumber(req.query.courseId);
      const branchId = optionalNumber(req.query.branchId);
      const batch = optionalString(req.query.batch) ?? null;
      const yearOfStudy = optionalNumber(req.query.yearOfStudy);
      const semesterNumber = optionalNumber(req.query.semesterNumber);
      let startDate = optionalString(req.query.startDate);
      let endDate = optionalString(req.query.endDate);

      scopedFilters(req, { collegeId, branchId });

      if ((!startDate || !endDate) && collegeId && courseId && yearOfStudy && semesterNumber) {
        const window = await resolveSemesterWindow({
          collegeId,
          courseId,
          batch,
          yearOfStudy,
          semesterNumber,
        });
        if (!window) {
          res.status(404).json({
            message: "Semester dates not found; pass startDate and endDate explicitly",
            source: "student_database.semesters",
          });
          return;
        }
        startDate = startDate ?? window.startDate;
        endDate = endDate ?? window.endDate;
      }

      if (!startDate || !endDate) {
        res.status(400).json({
          message:
            "startDate and endDate are required (or pass collegeId, courseId, yearOfStudy, semesterNumber to use the semester window)",
        });
        return;
      }

      const data = await listCustomHolidays({
        startDate,
        endDate,
        scope: {
          collegeId,
          courseId,
          branchId,
          batch,
          yearOfStudy,
          semesterNumber,
        },
      });

      res.json({
        source: "student_database.custom_holidays",
        startDate,
        endDate,
        count: data.length,
        data,
      });
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

academicDatesRouter.get(
  "/attendance-calendar/month",
  requirePermission("attendance_calendar.view"),
  async (req, res, next) => {
    try {
      const now = new Date();
      const year = optionalNumber(req.query.year) ?? now.getFullYear();
      const month = optionalNumber(req.query.month) ?? now.getMonth() + 1;
      res.json(await getMonthAttendanceCalendar({ year, month }));
    } catch (error) {
      next(error);
    }
  },
);

academicDatesRouter.get(
  "/holiday-targets",
  requirePermission("attendance_calendar.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const options = await listHolidayTargetOptions();
      const allowed = await allowedCollegeNames(getAuthz(req));
      if (allowed == null) {
        res.json(options);
        return;
      }
      const allowedSet = new Set(allowed.map((n) => n.toLowerCase()));
      const colleges = options.colleges.filter((c) =>
        allowedSet.has(String(c.name).trim().toLowerCase()),
      );
      const collegeIds = new Set(colleges.map((c) => c.id));
      const programs = options.programs.filter((p) => collegeIds.has(p.collegeId));
      res.json({ ...options, colleges, programs });
    } catch (error) {
      next(error);
    }
  },
);

academicDatesRouter.get(
  "/holiday-recipients",
  requirePermission("attendance_calendar.view"),
  async (req, res, next) => {
    try {
      const colleges = optionalString(req.query.colleges);
      const batches = optionalString(req.query.batches);
      const programs = optionalString(req.query.programs);
      res.json(
        await estimateHolidayRecipients({
          collegeNames: colleges ? colleges.split("|").map((s) => s.trim()).filter(Boolean) : [],
          batchValues: batches ? batches.split("|").map((s) => s.trim()).filter(Boolean) : [],
          programNames: programs ? programs.split("|").map((s) => s.trim()).filter(Boolean) : [],
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

academicDatesRouter.post(
  "/holidays",
  requirePermission("attendance_calendar.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body ?? {};
      const targetColleges = stringArray(body.targetColleges);
      await assertCollegeNamesInScope(getAuthz(req), targetColleges);
      const created = await createCustomHoliday({
        holidayDate: String(body.holidayDate ?? ""),
        title: String(body.title ?? ""),
        description: body.description != null ? String(body.description) : null,
        targetColleges,
        targetBatches: stringArray(body.targetBatches),
        targetPrograms: stringArray(body.targetPrograms),
      });
      await writeAuditLog({
        actorUserId: req.authUser!.id,
        action: "holiday.created",
        entityType: "custom_holidays",
        entityId: Number((created as { id?: number }).id ?? 0) || null,
        newValue: {
          holidayDate: String(body.holidayDate ?? ""),
          title: String(body.title ?? ""),
          targetColleges,
        },
        ipAddress: req.ip,
      });
      res.status(201).json(created);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

academicDatesRouter.put(
  "/holidays/:id",
  requirePermission("attendance_calendar.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const holidayId = Number(req.params.id);
      const body = req.body ?? {};
      const targetColleges = stringArray(body.targetColleges);
      await assertCollegeNamesInScope(getAuthz(req), targetColleges);
      const updated = await updateCustomHoliday(holidayId, {
        holidayDate: String(body.holidayDate ?? ""),
        title: String(body.title ?? ""),
        description: body.description != null ? String(body.description) : null,
        targetColleges,
        targetBatches: stringArray(body.targetBatches),
        targetPrograms: stringArray(body.targetPrograms),
      });
      await writeAuditLog({
        actorUserId: req.authUser!.id,
        action: "holiday.updated",
        entityType: "custom_holidays",
        entityId: holidayId,
        newValue: {
          holidayDate: String(body.holidayDate ?? ""),
          title: String(body.title ?? ""),
          targetColleges,
        },
        ipAddress: req.ip,
      });
      res.json(updated);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

async function handleAttendanceCalendar(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const collegeId = requiredNumber(req.query.collegeId, "collegeId");
    const branchId = optionalNumber(req.query.branchId);
    scopedFilters(req, { collegeId, branchId });
    const courseId = requiredNumber(req.query.courseId, "courseId");
    const batch = optionalString(req.query.batch) ?? null;
    const yearOfStudy = requiredNumber(req.query.yearOfStudy, "yearOfStudy");
    const semesterNumber = requiredNumber(req.query.semesterNumber, "semesterNumber");

    const calendar = await getAttendanceCalendar({
      collegeId,
      courseId,
      branchId,
      batch,
      yearOfStudy,
      semesterNumber,
    });

    if (!calendar) {
      res.status(404).json({
        message: "Semester dates not found in Student Database for this scope",
        source: "student_database.semesters",
        code: "SEMESTER_NOT_CONFIGURED",
      });
      return;
    }

    res.json(calendar);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 400 || status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
}

academicDatesRouter.get(
  "/calendar",
  requirePermission("attendance_calendar.view"),
  handleAttendanceCalendar,
);
academicDatesRouter.get(
  "/attendance-calendar",
  requirePermission("attendance_calendar.view"),
  handleAttendanceCalendar,
);
