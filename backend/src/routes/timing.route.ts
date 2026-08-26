import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  ensureEntityScope,
  requirePermission,
  scopedFilters,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  createTimingTemplate,
  getOrCreateTimingForContext,
  getTimingSlotUsage,
  getTimingTemplateDetail,
  listTimingTemplates,
  replaceTimingSlots,
  saveTimingForContext,
  setTimingTemplateStatus,
  updateTimingTemplate,
  type DayCode,
  type SlotSaveInput,
  type SlotType,
  type TemplateStatus,
} from "../services/timing.service.js";
import { writeAuditLog } from "../services/audit.service.js";

export const timingRouter = Router();

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

function sendAuthz(
  res: import("express").Response,
  error: unknown,
  next: import("express").NextFunction,
) {
  const status = statusFromAuthzError(error);
  if (status === 401 || status === 403 || status === 404) {
    res.status(status).json({ message: (error as Error).message || "Forbidden" });
    return;
  }
  next(error);
}

async function assertTemplateInScope(req: AuthedRequest, templateId: number) {
  const detail = await getTimingTemplateDetail(templateId, { includeInactiveSlots: false });
  if (!detail) {
    throw Object.assign(new Error("Timing template not found"), { status: 404 });
  }
  ensureEntityScope(req, { collegeId: detail.collegeId, branchId: null });
  return detail;
}

timingRouter.get("/", requirePermission("timetable.view"), async (req: AuthedRequest, res, next) => {
  try {
    const scoped = scopedFilters(req, { collegeId: num(req.query.collegeId) });
    const data = await listTimingTemplates({
      collegeId: scoped.collegeId,
      academicYear: str(req.query.academicYear),
      semester: num(req.query.semester),
      status: str(req.query.status),
    });
    const filtered =
      scoped.collegeIds?.length && scoped.collegeId == null
        ? data.filter((t) => scoped.collegeIds!.includes(Number(t.collegeId)))
        : data;
    res.json({ data: filtered });
  } catch (error) {
    sendAuthz(res, error, next);
  }
});

timingRouter.get(
  "/for-context",
  requirePermission("timetable.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId = num(req.query.collegeId);
      const academicYear = str(req.query.academicYear);
      const semester = num(req.query.semester);
      if (!collegeId || !academicYear || !semester) {
        res.status(400).json({
          message: "collegeId, academicYear and semester are required",
        });
        return;
      }
      scopedFilters(req, { collegeId });
      const createIfMissing = String(req.query.createIfMissing ?? "") === "true";
      if (createIfMissing) {
        res.json(await getOrCreateTimingForContext({ collegeId, academicYear, semester }));
        return;
      }
      const list = await listTimingTemplates({
        collegeId,
        academicYear,
        status: undefined,
        semester,
      });
      const active = list.find((t) => t.status === "active") ?? list[0] ?? null;
      if (!active) {
        res.json({ timing: null });
        return;
      }
      res.json({ timing: await getTimingTemplateDetail(active.id) });
    } catch (error) {
      sendAuthz(res, error, next);
    }
  },
);

timingRouter.put(
  "/for-context",
  requirePermission("timetable.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as {
        collegeId: number;
        academicYear: string;
        semester: number;
        name?: string;
        slots: SlotSaveInput[];
        confirmDestructive?: boolean;
      };
      scopedFilters(req, { collegeId: Number(body.collegeId) });
      const saved = await saveTimingForContext(body);
      await writeAuditLog({
        actorUserId: req.authUser!.id,
        action: "timing.saved_for_context",
        entityType: "ap_timing_template",
        entityId: Number((saved as { id?: number }).id ?? 0) || null,
        newValue: {
          collegeId: body.collegeId,
          academicYear: body.academicYear,
          semester: body.semester,
        },
        ipAddress: req.ip,
      });
      res.json(saved);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      const err = error as Error & { code?: string; affected?: unknown; details?: string[] };
      if (err.code === "TIMING_IN_USE") {
        res.status(409).json({
          message: err.message,
          code: err.code,
          affected: err.affected,
        });
        return;
      }
      if (err.details) {
        res.status(400).json({ message: err.message, details: err.details });
        return;
      }
      next(error);
    }
  },
);

timingRouter.get(
  "/:templateId",
  requirePermission("timetable.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const detail = await assertTemplateInScope(req, Number(req.params.templateId));
      res.json(detail);
    } catch (error) {
      sendAuthz(res, error, next);
    }
  },
);

timingRouter.get(
  "/:templateId/usage",
  requirePermission("timetable.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      await assertTemplateInScope(req, Number(req.params.templateId));
      res.json(await getTimingSlotUsage(Number(req.params.templateId)));
    } catch (error) {
      sendAuthz(res, error, next);
    }
  },
);

timingRouter.post("/", requirePermission("timetable.edit"), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body as {
      collegeId: number;
      academicYear: string;
      semester: number;
      name: string;
      status?: TemplateStatus;
      notes?: string | null;
    };
    scopedFilters(req, { collegeId: Number(body.collegeId) });
    const created = await createTimingTemplate(body);
    res.status(201).json(created);
  } catch (error) {
    sendAuthz(res, error, next);
  }
});

timingRouter.put(
  "/:templateId",
  requirePermission("timetable.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      await assertTemplateInScope(req, Number(req.params.templateId));
      if (req.body?.collegeId != null) {
        scopedFilters(req, { collegeId: Number(req.body.collegeId) });
      }
      const updated = await updateTimingTemplate(Number(req.params.templateId), req.body);
      res.json(updated);
    } catch (error) {
      sendAuthz(res, error, next);
    }
  },
);

timingRouter.post(
  "/:templateId/activate",
  requirePermission("timetable.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      await assertTemplateInScope(req, Number(req.params.templateId));
      res.json(await setTimingTemplateStatus(Number(req.params.templateId), "active"));
    } catch (error) {
      sendAuthz(res, error, next);
    }
  },
);

timingRouter.post(
  "/:templateId/deactivate",
  requirePermission("timetable.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      await assertTemplateInScope(req, Number(req.params.templateId));
      res.json(await setTimingTemplateStatus(Number(req.params.templateId), "draft"));
    } catch (error) {
      sendAuthz(res, error, next);
    }
  },
);

timingRouter.put(
  "/:templateId/slots",
  requirePermission("timetable.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      await assertTemplateInScope(req, Number(req.params.templateId));
      const slots = (req.body?.slots ?? []) as SlotSaveInput[];
      const normalized = slots.map((slot) => ({
        id: slot.id ? Number(slot.id) : null,
        dayOfWeek: slot.dayOfWeek as DayCode,
        slotOrder: Number(slot.slotOrder),
        label: String(slot.label ?? ""),
        startTime: String(slot.startTime ?? ""),
        endTime: String(slot.endTime ?? ""),
        slotType: slot.slotType as SlotType,
      }));
      const updated = await replaceTimingSlots(Number(req.params.templateId), normalized, {
        confirmDestructive: Boolean(req.body?.confirmDestructive),
      });
      res.json(updated);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403 || status === 404) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      const err = error as Error & { code?: string; affected?: unknown; details?: string[] };
      if (err.code === "TIMING_IN_USE") {
        res.status(409).json({
          message: err.message,
          code: err.code,
          affected: err.affected,
        });
        return;
      }
      if (err.details) {
        res.status(400).json({ message: err.message, details: err.details });
        return;
      }
      next(error);
    }
  },
);
