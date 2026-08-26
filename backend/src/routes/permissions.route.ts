import { Router } from "express";
import { requirePermission, statusFromAuthzError } from "../authz/require-permission.js";
import { listPermissionsCatalog } from "../services/role-management.service.js";

export const permissionsRouter = Router();

permissionsRouter.get(
  "/",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (_req, res, next) => {
    try {
      res.json({ data: await listPermissionsCatalog() });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status >= 400 && status < 500) {
        res.status(status).json({ message: (error as Error).message || "Request failed" });
        return;
      }
      next(error);
    }
  },
);
