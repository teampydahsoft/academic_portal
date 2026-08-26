import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  getStudentAttendance,
  getStudentById,
  getStudentListStats,
  getStudentPhoto,
  getStudentScope,
  listStudentStatuses,
  listStudents,
} from "../services/students.service.js";

export const studentsRouter = Router();

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "" || value === "all") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
}

async function assertStudentInScope(req: AuthedRequest, studentId: string) {
  const scope = await getStudentScope(studentId);
  if (!scope) {
    throw Object.assign(new Error("Student not found"), { status: 404 });
  }
  ensureEntityScope(req, scope);
}

studentsRouter.get("/", requirePermission("students.view"), async (req: AuthedRequest, res, next) => {
  try {
    const scoped = scopedFilters(req, {
      collegeId: optionalNumber(req.query.collegeId),
      branchId: optionalNumber(req.query.branchId),
    });
    const result = await listStudents({
      q: typeof req.query.q === "string" ? req.query.q : "",
      collegeId: scoped.collegeId,
      collegeIds: scoped.collegeIds,
      courseId: optionalNumber(req.query.courseId),
      branchId: scoped.branchId,
      branchIds: scoped.branchIds,
      batch: optionalString(req.query.batch),
      year: optionalNumber(req.query.year),
      semester: optionalNumber(req.query.semester),
      section: optionalString(req.query.section),
      status: optionalString(req.query.status),
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    res.json({
      data: result.data,
      count: result.data.length,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

studentsRouter.get("/statuses", requirePermission("students.view"), async (_req, res, next) => {
  try {
    const statuses = await listStudentStatuses();
    res.json({ data: statuses });
  } catch (error) {
    next(error);
  }
});

studentsRouter.get("/stats", requirePermission("students.view"), async (req: AuthedRequest, res, next) => {
  try {
    const scoped = scopedFilters(req, {
      collegeId: optionalNumber(req.query.collegeId),
      branchId: optionalNumber(req.query.branchId),
    });
    const stats = await getStudentListStats({
      q: typeof req.query.q === "string" ? req.query.q : "",
      collegeId: scoped.collegeId,
      collegeIds: scoped.collegeIds,
      courseId: optionalNumber(req.query.courseId),
      branchId: scoped.branchId,
      branchIds: scoped.branchIds,
      batch: optionalString(req.query.batch),
      year: optionalNumber(req.query.year),
      semester: optionalNumber(req.query.semester),
      section: optionalString(req.query.section),
      status: optionalString(req.query.status),
    });
    res.json(stats);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value);
}

studentsRouter.get("/:id/photo", requirePermission("students.view"), async (req: AuthedRequest, res, next) => {
  try {
    const id = paramId(req.params.id);
    await assertStudentInScope(req, id);
    const photo = await getStudentPhoto(id);
    if (!photo) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    res.json(photo);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403 || status === 404) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

studentsRouter.get(
  "/:id/attendance",
  requirePermission("students.view", "attendance.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = paramId(req.params.id);
      await assertStudentInScope(req, id);
      const attendance = await getStudentAttendance(
        id,
        optionalNumber(req.query.year),
        optionalNumber(req.query.semester),
      );
      if (!attendance) {
        res.status(404).json({ message: "Student not found" });
        return;
      }
      res.json(attendance);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403 || status === 404) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

studentsRouter.get("/:id", requirePermission("students.view"), async (req: AuthedRequest, res, next) => {
  try {
    const id = paramId(req.params.id);
    await assertStudentInScope(req, id);
    const student = await getStudentById(id);
    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    res.json(student);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403 || status === 404) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});
