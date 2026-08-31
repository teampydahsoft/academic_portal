import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  getAuthz,
  requirePermission,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  createSubstitutionDetails,
  listReplacementFacultyAvailability,
  listTimingSlotsForSubstitution,
  loadSubstitutionDetailByRequestId,
  resolveClassAssignment,
} from "../services/faculty-substitution.service.js";

export const facultySubstitutionRouter = Router();

function num(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function handleError(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  const status = statusFromAuthzError(error);
  if (status >= 400 && status < 500) {
    res.status(status).json({ message: (error as Error).message || "Request failed" });
    return;
  }
  next(error);
}

facultySubstitutionRouter.post(
  "/resolve-class",
  requirePermission("request.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const sessionDate = str(req.body?.sessionDate);
      const collegeId = num(req.body?.collegeId);
      const courseId = num(req.body?.courseId);
      const branchId = num(req.body?.branchId);
      const batch = str(req.body?.batch);
      const sectionName = str(req.body?.sectionName);
      const timingSlotId = num(req.body?.timingSlotId);
      if (!sessionDate || !collegeId || !courseId || !branchId || !batch || !sectionName || !timingSlotId) {
        res.status(400).json({ message: "Missing required class resolution fields" });
        return;
      }
      res.json(
        await resolveClassAssignment(getAuthz(req), {
          sessionDate,
          collegeId,
          courseId,
          branchId,
          batch,
          yearOfStudy: num(req.body?.yearOfStudy),
          semesterNumber: num(req.body?.semesterNumber),
          sectionName,
          timingSlotId,
          academicYear: str(req.body?.academicYear),
        }),
      );
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

facultySubstitutionRouter.get(
  "/periods",
  requirePermission("request.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const sessionDate = str(req.query.sessionDate);
      const collegeId = num(req.query.collegeId);
      const courseId = num(req.query.courseId);
      const branchId = num(req.query.branchId);
      const batch = str(req.query.batch);
      const sectionName = str(req.query.sectionName);
      if (!sessionDate || !collegeId || !courseId || !branchId || !batch || !sectionName) {
        res.status(400).json({ message: "Missing required period lookup fields" });
        return;
      }
      res.json({
        data: await listTimingSlotsForSubstitution(getAuthz(req), {
          sessionDate,
          collegeId,
          courseId,
          branchId,
          batch,
          yearOfStudy: num(req.query.yearOfStudy),
          semesterNumber: num(req.query.semesterNumber),
          sectionName,
          academicYear: str(req.query.academicYear),
        }),
      });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

facultySubstitutionRouter.get(
  "/faculty-availability",
  requirePermission("request.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const sessionDate = str(req.query.sessionDate);
      const collegeId = num(req.query.collegeId);
      const branchId = num(req.query.branchId);
      const timingSlotId = num(req.query.timingSlotId);
      const timetableEntryId = num(req.query.timetableEntryId);
      if (!sessionDate || !collegeId || !branchId || !timingSlotId || !timetableEntryId) {
        res.status(400).json({ message: "Missing required availability fields" });
        return;
      }
      res.json({
        data: await listReplacementFacultyAvailability(getAuthz(req), {
          sessionDate,
          collegeId,
          branchId,
          timingSlotId,
          timetableEntryId,
          search: str(req.query.search),
          limit: num(req.query.limit),
        }),
      });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

facultySubstitutionRouter.get(
  "/requests/:requestId",
  requirePermission("request.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const requestId = num(req.params.requestId);
      if (!requestId) {
        res.status(400).json({ message: "Invalid request id" });
        return;
      }
      const detail = await loadSubstitutionDetailByRequestId(requestId);
      if (!detail) {
        res.status(404).json({ message: "Substitution details not found" });
        return;
      }
      res.json(detail);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

facultySubstitutionRouter.post(
  "/requests/:requestId/details",
  requirePermission("request.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const requestId = num(req.params.requestId);
      if (!requestId) {
        res.status(400).json({ message: "Invalid request id" });
        return;
      }
      const sessionDate = str(req.body?.sessionDate);
      const timetableEntryId = num(req.body?.timetableEntryId);
      const replacementFacultyStaffLinkId = num(req.body?.replacementFacultyStaffLinkId);
      const reason = str(req.body?.reason);
      const collegeId = num(req.body?.collegeId);
      const courseId = num(req.body?.courseId);
      const branchId = num(req.body?.branchId);
      const batch = str(req.body?.batch);
      const sectionName = str(req.body?.sectionName);
      const timingSlotId = num(req.body?.timingSlotId);
      if (
        !sessionDate ||
        !timetableEntryId ||
        !replacementFacultyStaffLinkId ||
        !reason ||
        !collegeId ||
        !courseId ||
        !branchId ||
        !batch ||
        !sectionName ||
        !timingSlotId
      ) {
        res.status(400).json({ message: "Missing required substitution fields" });
        return;
      }
      await createSubstitutionDetails(
        getAuthz(req),
        requestId,
        {
          sessionDate,
          timetableEntryId,
          replacementFacultyStaffLinkId,
          reason,
          collegeId,
          courseId,
          branchId,
          batch,
          yearOfStudy: num(req.body?.yearOfStudy),
          semesterNumber: num(req.body?.semesterNumber),
          sectionName,
          timingSlotId,
          academicYear: str(req.body?.academicYear),
        },
        req.ip,
      );
      res.status(201).json(await loadSubstitutionDetailByRequestId(requestId));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);
