import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../authz/require-permission.js";
import {
  getFacultyDisplaySettings,
  setFacultyEnabledGroups,
} from "../services/portal-settings.service.js";
import {
  getWorkloadThresholdSettings,
  saveWorkloadThresholdSettings,
} from "../services/workload-thresholds.service.js";
import { writeAuditLog } from "../services/audit.service.js";

export const settingsRouter = Router();

settingsRouter.get(
  "/faculty-display",
  requirePermission("settings.view"),
  async (_req, res, next) => {
    try {
      res.json(await getFacultyDisplaySettings());
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.put(
  "/faculty-display",
  requirePermission("settings.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const raw = req.body?.enabledGroupIds;
      if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
        res.status(400).json({
          message: "enabledGroupIds (string[]) is required",
        });
        return;
      }
      const previous = await getFacultyDisplaySettings();
      const updated = await setFacultyEnabledGroups(raw);
      await writeAuditLog({
        actorUserId: req.authUser!.id,
        action: "settings.faculty_display_updated",
        entityType: "ap_portal_settings",
        entityId: null,
        oldValue: {
          enabledGroupIds: previous.groups.filter((g) => g.enabled).map((g) => g.id),
        },
        newValue: {
          enabledGroupIds: raw,
        },
        ipAddress: req.ip,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.get(
  "/workload-thresholds",
  requirePermission("settings.view"),
  async (req, res, next) => {
    try {
      const collegeId =
        req.query.collegeId == null || req.query.collegeId === ""
          ? null
          : Number(req.query.collegeId);
      res.json(
        await getWorkloadThresholdSettings(
          Number.isFinite(collegeId) && collegeId! > 0 ? collegeId : null,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.put(
  "/workload-thresholds",
  requirePermission("settings.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeId =
        req.body?.collegeId == null || req.body?.collegeId === ""
          ? null
          : Number(req.body.collegeId);
      const previous = await getWorkloadThresholdSettings(
        Number.isFinite(collegeId) && collegeId! > 0 ? collegeId : null,
      );
      const updated = await saveWorkloadThresholdSettings({
        collegeId: Number.isFinite(collegeId) && collegeId! > 0 ? collegeId : null,
        minPeriodsPerWeek: Number(req.body?.minPeriodsPerWeek),
        maxPeriodsPerWeek: Number(req.body?.maxPeriodsPerWeek),
        maxPeriodsPerDay: Number(req.body?.maxPeriodsPerDay),
        minHoursPerWeek: req.body?.minHoursPerWeek,
        maxHoursPerWeek: req.body?.maxHoursPerWeek,
      });
      await writeAuditLog({
        actorUserId: req.authUser!.id,
        action: "settings.workload_thresholds_updated",
        entityType: "ap_workload_thresholds",
        entityId: null,
        oldValue: previous.thresholds,
        newValue: updated.thresholds,
        ipAddress: req.ip,
      });
      res.json(updated);
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);
