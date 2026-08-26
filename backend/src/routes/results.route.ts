import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
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
  getExamResults,
  getStudentResults,
  listResultOptions,
  listResults,
} from "../services/results.service.js";

export const resultsRouter = Router();

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

function resultStatus(value: unknown): "pass" | "fail" | undefined {
  const v = str(value)?.toLowerCase();
  if (v === "pass" || v === "fail") return v;
  return undefined;
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

resultsRouter.get("/", requirePermission("results.view"), async (req: AuthedRequest, res, next) => {
  try {
    const scoped = applyListScope(req);
    res.json(
      await listResults({
        collegeId: scoped.collegeId,
        courseId: num(req.query.courseId),
        branchId: scoped.branchId,
        batch: str(req.query.batch),
        year: num(req.query.year),
        semester: num(req.query.semester),
        examId: num(req.query.examId),
        examType: str(req.query.examType) ?? str(req.query.type),
        student: str(req.query.student),
        resultStatus: resultStatus(req.query.resultStatus),
        q: str(req.query.q),
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      }),
    );
  } catch (error) {
    sendScopedError(res, error, next);
  }
});

resultsRouter.get("/options", requirePermission("results.view"), async (_req, res, next) => {
  try {
    res.json(await listResultOptions());
  } catch (error) {
    next(error);
  }
});

resultsRouter.get(
  "/student/:rollNumber",
  requirePermission("results.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rollNumber = decodeURIComponent(
        String(
          Array.isArray(req.params.rollNumber) ? req.params.rollNumber[0] : req.params.rollNumber ?? "",
        ),
      ).trim();
      if (!rollNumber) {
        res.status(400).json({ message: "rollNumber is required" });
        return;
      }
      await assertStudentRollAccessible(getAuthz(req), rollNumber);
      const data = await getStudentResults(rollNumber);
      if (!data) {
        res.status(404).json({ message: "No results found for this student" });
        return;
      }
      res.json(data);
    } catch (error) {
      sendScopedError(res, error, next);
    }
  },
);

resultsRouter.get(
  "/:examId",
  requirePermission("results.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const examId = Number(
        Array.isArray(req.params.examId) ? req.params.examId[0] : req.params.examId,
      );
      if (!Number.isInteger(examId) || examId <= 0) {
        res.status(400).json({ message: "Invalid exam id" });
        return;
      }
      await assertExamAccessible(getAuthz(req), examId);
      const data = await getExamResults(examId);
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
