import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { requirePermission, statusFromAuthzError } from "../authz/require-permission.js";
import {
  createRole,
  deleteRole,
  getManagedRole,
  listManagedRoles,
  listPermissionsCatalog,
  setRoleActiveStatus,
  setRolePermissions,
  updateRole,
} from "../services/role-management.service.js";

export const rolesRouter = Router();

function sendError(
  res: import("express").Response,
  error: unknown,
  next: import("express").NextFunction,
) {
  const status = statusFromAuthzError(error);
  if (status >= 400 && status < 500) {
    const err = error as Error & {
      code?: string;
      assignmentCount?: number;
      activeUserCount?: number;
    };
    res.status(status).json({
      message: err.message || "Request failed",
      ...(err.code ? { code: err.code } : {}),
      ...(typeof err.assignmentCount === "number" ? { assignmentCount: err.assignmentCount } : {}),
      ...(typeof err.activeUserCount === "number" ? { activeUserCount: err.activeUserCount } : {}),
    });
    return;
  }
  next(error);
}

function paramId(value: string | string[]): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid role id"), { status: 400 });
  }
  return id;
}

rolesRouter.get(
  "/permissions",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (_req, res, next) => {
    try {
      res.json({ data: await listPermissionsCatalog() });
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

rolesRouter.get(
  "/",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (req, res, next) => {
    try {
      const includeInactive = String(req.query.includeInactive ?? "true") !== "false";
      res.json({ data: await listManagedRoles(includeInactive) });
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

rolesRouter.get(
  "/:id",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (req, res, next) => {
    try {
      const role = await getManagedRole(paramId(req.params.id));
      if (!role) {
        res.status(404).json({ message: "Role not found" });
        return;
      }
      res.json(role);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

rolesRouter.post("/", requirePermission("user_management.manage_users"), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const created = await createRole({
      label: String(body.label ?? body.name ?? ""),
      description: body.description != null ? String(body.description) : null,
      roleKey: body.roleKey != null ? String(body.roleKey) : null,
      isGlobalCapable: Boolean(body.isGlobalCapable),
      permissionKeys: Array.isArray(body.permissionKeys)
        ? body.permissionKeys.map((k: unknown) => String(k))
        : [],
      actorUserId: req.authUser!.id,
      ipAddress: req.ip,
    });
    res.status(201).json(created);
  } catch (error) {
    sendError(res, error, next);
  }
});

rolesRouter.put("/:id", requirePermission("user_management.manage_users"), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const updated = await updateRole({
      roleId: paramId(req.params.id),
      label: body.label != null ? String(body.label) : undefined,
      description: body.description !== undefined ? body.description : undefined,
      isGlobalCapable:
        body.isGlobalCapable != null ? Boolean(body.isGlobalCapable) : undefined,
      confirmImpact: Boolean(body.confirmImpact),
      actorUserId: req.authUser!.id,
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (error) {
    sendError(res, error, next);
  }
});

rolesRouter.put(
  "/:id/permissions",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body ?? {};
      if (!Array.isArray(body.permissionKeys)) {
        res.status(400).json({ message: "permissionKeys (string[]) is required" });
        return;
      }
      const updated = await setRolePermissions({
        roleId: paramId(req.params.id),
        permissionKeys: body.permissionKeys.map((k: unknown) => String(k)),
        confirmImpact: Boolean(body.confirmImpact),
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.json(updated);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

rolesRouter.put(
  "/:id/status",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body ?? {};
      if (typeof body.isActive !== "boolean") {
        res.status(400).json({ message: "isActive (boolean) is required" });
        return;
      }
      const updated = await setRoleActiveStatus({
        roleId: paramId(req.params.id),
        isActive: body.isActive,
        confirmImpact: Boolean(body.confirmImpact),
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.json(updated);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

rolesRouter.delete(
  "/:id",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const confirmImpact =
        String(req.query.confirmImpact ?? "") === "true" ||
        Boolean((req.body as { confirmImpact?: boolean } | undefined)?.confirmImpact);
      res.json(
        await deleteRole({
          roleId: paramId(req.params.id),
          confirmImpact,
          actorUserId: req.authUser!.id,
          ipAddress: req.ip,
        }),
      );
    } catch (error) {
      sendError(res, error, next);
    }
  },
);
