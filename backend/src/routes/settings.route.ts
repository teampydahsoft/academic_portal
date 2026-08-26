import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../authz/require-permission.js";
import {
  getFacultyDisplaySettings,
  setFacultyEnabledGroups,
} from "../services/portal-settings.service.js";
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
