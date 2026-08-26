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
  assertExamAccessible,
  assertStudentRollAccessible,
} from "../authz/academic-entity-scope.js";
import {
  getExaminationDetail,
  getStudentExaminations,
  listExaminationApplications,
  listExaminationOptions,
  listExaminationScopes,
  listExaminationSubjects,
  listExaminations,
} from "../services/examinations.service.js";
import { getStudentScope } from "../services/students.service.js";

export const examinationsRouter = Router();

function num(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (value === "" || value === "all") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
}

function examIdParam(value: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function applyListScope(req: AuthedRequest) {
  const scoped = scopedFilters(req, {
    collegeId: num(req.query.collegeId),
    branchId: num(req.query.branchId),
  });
  if (scoped.collegeIds?.length && scoped.collegeId == null) {
    throw Object.assign(new Error("collegeId is required for your academic scope"), {
      status: 400,
    });
  }
  return scoped;
}

function sendScopedError(
  res: import("express").Response,
  error: unknown,
  next: import("express").NextFunction,
) {
  const status = statusFromAuthzError(error);
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    res.status(status).json({ message: (error as Error).message || "Forbidden" });
    return;
  }
  next(error);
}

async function requireExamScope(req: AuthedRequest, examId: number) {
  await assertExamAccessible(getAuthz(req), examId);
}

examinationsRouter.get(
  "/",
  requirePermission("examinations.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const scoped = applyListScope(req);
      res.json(
        await listExaminations({
          collegeId: scoped.collegeId,
          courseId: num(req.query.courseId),
          branchId: scoped.branchId,
          batch: str(req.query.batch),
          year: num(req.query.year),
          semester: num(req.query.semester),
          regulationId: num(req.query.regulationId),
          status: str(req.query.status),
          type: str(req.query.type),
          q: str(req.query.q),
        }),
      );
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);

examinationsRouter.get(
  "/options",
  requirePermission("examinations.view"),
  async (_req, res, next) => {
    try {
      res.json(await listExaminationOptions());
    } catch (error) {
      next(error);
    }
  },
);

examinationsRouter.get(
  "/for-student",
  requirePermission("examinations.view", "students.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const studentId = num(req.query.studentId);
      const rollNumber = str(req.query.rollNumber);
      if (studentId == null && !rollNumber) {
        res.status(400).json({ message: "studentId or rollNumber is required" });
        return;
      }
      if (studentId != null) {
        const scope = await getStudentScope(String(studentId));
        if (!scope) {
          res.status(404).json({ message: "Student not found in Student Database" });
          return;
        }
        ensureEntityScope(req, scope);
      } else if (rollNumber) {
        await assertStudentRollAccessible(getAuthz(req), rollNumber);
      }
      const data = await getStudentExaminations({ studentId, rollNumber });
      if (!data) {
        res.status(404).json({ message: "Student not found in Student Database" });
        return;
      }
      res.json(data);
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);

examinationsRouter.get(
  "/:id/subjects",
  requirePermission("examinations.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = examIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ message: "Invalid exam id" });
        return;
      }
      await requireExamScope(req, id);
      const data = await listExaminationSubjects(id);
      if (!data) {
        res.status(404).json({ message: "Examination not found" });
        return;
      }
      res.json(data);
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);

examinationsRouter.get(
  "/:id/scopes",
  requirePermission("examinations.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = examIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ message: "Invalid exam id" });
        return;
      }
      await requireExamScope(req, id);
      const data = await listExaminationScopes(id);
      if (!data) {
        res.status(404).json({ message: "Examination not found" });
        return;
      }
      res.json(data);
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);

examinationsRouter.get(
  "/:id/applications",
  requirePermission("examinations.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = examIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ message: "Invalid exam id" });
        return;
      }
      await requireExamScope(req, id);
      const data = await listExaminationApplications(id);
      if (!data) {
        res.status(404).json({ message: "Examination not found" });
        return;
      }
      res.json(data);
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);

examinationsRouter.get(
  "/:id",
  requirePermission("examinations.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = examIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ message: "Invalid exam id" });
        return;
      }
      await requireExamScope(req, id);
      const data = await getExaminationDetail(id);
      if (!data) {
        res.status(404).json({ message: "Examination not found" });
        return;
      }
      res.json(data);
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);
