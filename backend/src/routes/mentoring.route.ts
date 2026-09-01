import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  getAuthz,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  addIntervention,
  assignMentor,
  assignMentorsBulk,
  assignMentorsBySections,
  createRiskCase,
  deactivateMentorAssignment,
  deactivateMentorSections,
  getMentoringDashboard,
  getMentoringStudentDetail,
  getRiskCaseById,
  listMentorAssignments,
  listMentorMenteesDetailed,
  parseMentorSectionScopes,
  searchMentoringStaff,
  updateRiskCaseStatus,
  type InterventionType,
  type RiskCaseStatus,
  RISK_CASE_STATUSES,
} from "../services/mentoring.service.js";

export const mentoringRouter = Router();

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

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value);
}

mentoringRouter.get("/dashboard", requirePermission("mentoring.view"), async (req: AuthedRequest, res, next) => {
  try {
    const scoped = scopedFilters(req, {
      collegeId: optionalNumber(req.query.collegeId),
      branchId: optionalNumber(req.query.branchId),
    });
    const risk = optionalString(req.query.risk) as "High" | "Medium" | "Low" | "all" | undefined;
    const caseStatus = optionalString(req.query.caseStatus) as RiskCaseStatus | "none" | "all" | undefined;
    const onlyAtRisk = req.query.onlyAtRisk === "false" ? false : true;

    const result = await getMentoringDashboard(getAuthz(req), {
      collegeId: scoped.collegeId,
      collegeIds: scoped.collegeIds,
      courseId: optionalNumber(req.query.courseId),
      branchId: scoped.branchId,
      branchIds: scoped.branchIds,
      batch: optionalString(req.query.batch),
      year: optionalNumber(req.query.year),
      semester: optionalNumber(req.query.semester),
      section: optionalString(req.query.section),
      q: typeof req.query.q === "string" ? req.query.q : "",
      mentorStaffLinkId: optionalNumber(req.query.mentorStaffLinkId),
      risk: risk ?? "all",
      caseStatus: caseStatus ?? "all",
      onlyAtRisk,
      limit: Number(req.query.limit ?? 100),
      offset: Number(req.query.offset ?? 0),
    });
    res.json(result);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

mentoringRouter.get("/staff-search", requirePermission("mentoring.assign"), async (req: AuthedRequest, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = optionalNumber(req.query.limit) ?? 40;
    const data = await searchMentoringStaff(getAuthz(req), q, limit);
    res.json({ data });
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

mentoringRouter.get("/assignments", requirePermission("mentoring.view"), async (req: AuthedRequest, res, next) => {
  try {
    const data = await listMentorAssignments(getAuthz(req), {
      facultyStaffLinkId: optionalNumber(req.query.facultyStaffLinkId),
      studentDbId: optionalNumber(req.query.studentDbId),
    });
    res.json({ data });
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

mentoringRouter.post("/assignments", requirePermission("mentoring.assign"), async (req: AuthedRequest, res, next) => {
  try {
    const studentDbId = Number(req.body?.studentDbId);
    const facultyStaffLinkId = Number(req.body?.facultyStaffLinkId);
    if (!Number.isFinite(studentDbId) || !Number.isFinite(facultyStaffLinkId)) {
      res.status(400).json({ message: "studentDbId and facultyStaffLinkId are required" });
      return;
    }
    const result = await assignMentor(getAuthz(req), {
      studentDbId,
      facultyStaffLinkId,
      academicYearLabel: typeof req.body?.academicYearLabel === "string" ? req.body.academicYearLabel : undefined,
      notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

mentoringRouter.post(
  "/assignments/bulk",
  requirePermission("mentoring.assign"),
  async (req: AuthedRequest, res, next) => {
    try {
      const facultyStaffLinkId = Number(req.body?.facultyStaffLinkId);
      const rawIds = Array.isArray(req.body?.studentDbIds) ? req.body.studentDbIds : [];
      const studentDbIds = rawIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id));
      if (!Number.isFinite(facultyStaffLinkId)) {
        res.status(400).json({ message: "facultyStaffLinkId is required" });
        return;
      }
      const result = await assignMentorsBulk(getAuthz(req), {
        facultyStaffLinkId,
        studentDbIds,
        academicYearLabel:
          typeof req.body?.academicYearLabel === "string" ? req.body.academicYearLabel : undefined,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        ipAddress: req.ip,
      });
      res.status(201).json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.post(
  "/assignments/by-sections",
  requirePermission("mentoring.assign"),
  async (req: AuthedRequest, res, next) => {
    try {
      const facultyStaffLinkId = Number(req.body?.facultyStaffLinkId);
      const sections = parseMentorSectionScopes(req.body?.sections);
      if (!Number.isFinite(facultyStaffLinkId)) {
        res.status(400).json({ message: "facultyStaffLinkId is required" });
        return;
      }
      if (sections.length === 0) {
        res.status(400).json({ message: "At least one valid section is required" });
        return;
      }
      const result = await assignMentorsBySections(getAuthz(req), {
        facultyStaffLinkId,
        sections,
        academicYearLabel:
          typeof req.body?.academicYearLabel === "string" ? req.body.academicYearLabel : undefined,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        ipAddress: req.ip,
      });
      res.status(201).json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.post(
  "/assignments/unassign-sections",
  requirePermission("mentoring.assign"),
  async (req: AuthedRequest, res, next) => {
    try {
      const facultyStaffLinkId = Number(req.body?.facultyStaffLinkId);
      const sections = parseMentorSectionScopes(req.body?.sections);
      if (!Number.isFinite(facultyStaffLinkId)) {
        res.status(400).json({ message: "facultyStaffLinkId is required" });
        return;
      }
      if (sections.length === 0) {
        res.status(400).json({ message: "At least one valid section is required" });
        return;
      }
      const result = await deactivateMentorSections(getAuthz(req), {
        facultyStaffLinkId,
        sections,
        ipAddress: req.ip,
      });
      res.json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.get(
  "/mentors/:staffLinkId/mentees",
  requirePermission("mentoring.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const staffLinkId = Number(paramId(req.params.staffLinkId));
      if (!Number.isFinite(staffLinkId)) {
        res.status(400).json({ message: "Invalid staff link id" });
        return;
      }
      const data = await listMentorMenteesDetailed(getAuthz(req), staffLinkId);
      res.json({ data });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.delete(
  "/assignments/:id",
  requirePermission("mentoring.assign"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = Number(paramId(req.params.id));
      if (!Number.isFinite(id)) {
        res.status(400).json({ message: "Invalid assignment id" });
        return;
      }
      await deactivateMentorAssignment(getAuthz(req), id, req.ip);
      res.json({ ok: true });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.post("/risk-cases", requirePermission("mentoring.case_manage"), async (req: AuthedRequest, res, next) => {
  try {
    const studentDbId = Number(req.body?.studentDbId);
    if (!Number.isFinite(studentDbId)) {
      res.status(400).json({ message: "studentDbId is required" });
      return;
    }
    const result = await createRiskCase(getAuthz(req), {
      studentDbId,
      riskType: typeof req.body?.riskType === "string" ? req.body.riskType : undefined,
      notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

mentoringRouter.get("/risk-cases/:id", requirePermission("mentoring.view"), async (req: AuthedRequest, res, next) => {
  try {
    const id = Number(paramId(req.params.id));
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "Invalid complaint id" });
      return;
    }
    const result = await getRiskCaseById(getAuthz(req), id);
    res.json(result);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status >= 400 && status < 500) {
      res.status(status).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

mentoringRouter.patch(
  "/risk-cases/:id/status",
  requirePermission("mentoring.case_manage", "mentoring.escalate"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = Number(paramId(req.params.id));
      const status = String(req.body?.status ?? "") as RiskCaseStatus;
      if (!Number.isFinite(id) || !RISK_CASE_STATUSES.includes(status)) {
        res.status(400).json({ message: "Valid complaint id and status are required" });
        return;
      }
      const result = await updateRiskCaseStatus(
        getAuthz(req),
        id,
        status,
        typeof req.body?.notes === "string" ? req.body.notes : undefined,
        req.ip,
      );
      res.json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.post(
  "/risk-cases/:id/interventions",
  requirePermission("mentoring.intervene"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = Number(paramId(req.params.id));
      const actionType = String(req.body?.actionType ?? "") as InterventionType;
      if (!Number.isFinite(id) || !actionType) {
        res.status(400).json({ message: "Valid complaint id and actionType are required" });
        return;
      }
      const result = await addIntervention(getAuthz(req), id, {
        actionType,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        outcome: typeof req.body?.outcome === "string" ? req.body.outcome : undefined,
        followUpDate: typeof req.body?.followUpDate === "string" ? req.body.followUpDate : null,
        ipAddress: req.ip,
      });
      res.status(201).json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

mentoringRouter.get(
  "/students/:studentId",
  requirePermission("mentoring.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const studentId = paramId(req.params.studentId);
      const result = await getMentoringStudentDetail(getAuthz(req), studentId);
      res.json(result);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);
