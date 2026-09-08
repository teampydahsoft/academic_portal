import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { requirePermission, statusFromAuthzError } from "../authz/require-permission.js";
import {
  deleteManagedUser,
  getManagedUser,
  linkHrmsUser,
  listApRoles,
  listManagedUsers,
  replaceUserRoles,
  searchHrmsCandidates,
  setUserActiveStatus,
  updateManagedUserProfile,
  updateUserAssignmentScope,
  setUserPermissions,
  syncAllTimetableStaffUsers,
} from "../services/user-management.service.js";

export const usersRouter = Router();

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

function paramId(value: string | string[]): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid user id"), { status: 400 });
  }
  return id;
}

function sendError(
  res: import("express").Response,
  error: unknown,
  next: import("express").NextFunction,
) {
  const status = statusFromAuthzError(error);
  if (status >= 400 && status < 500) {
    res.status(status).json({ message: (error as Error).message || "Request failed" });
    return;
  }
  next(error);
}

usersRouter.get(
  "/",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (req, res, next) => {
    try {
      const status = str(req.query.status);
      res.json(
        await listManagedUsers({
          q: str(req.query.q),
          roleKey: str(req.query.roleKey),
          status:
            status === "active" || status === "inactive" || status === "all" ? status : "all",
          collegeId: num(req.query.collegeId),
          branchId: num(req.query.branchId),
          limit: num(req.query.limit),
          offset: num(req.query.offset),
        }),
      );
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.get(
  "/roles",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (_req, res, next) => {
    try {
      res.json({ data: await listApRoles() });
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.get(
  "/hrms-search",
  requirePermission("user_management.manage_users"),
  async (req, res, next) => {
    try {
      const q = str(req.query.q) ?? "";
      res.json({ data: await searchHrmsCandidates(q, num(req.query.limit) ?? 20) });
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.post(
  "/sync-timetables",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await syncAllTimetableStaffUsers({
        actorUserId: req.authUser?.id,
        ipAddress: req.ip,
      });
      res.json({
        ok: true,
        message: "Timetable staff users synchronized successfully",
        ...result,
      });
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.get(
  "/:id",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (req, res, next) => {
    try {
      const user = await getManagedUser(paramId(req.params.id));
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.post(
  "/link",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body ?? {};
      const hrmsUserId = str(body.hrmsUserId);
      const roleKey = str(body.roleKey);
      if (!hrmsUserId || !roleKey) {
        res.status(400).json({ message: "hrmsUserId and roleKey are required" });
        return;
      }

      const scopes = Array.isArray(body.scopes)
        ? body.scopes.map(
            (s: { collegeId?: number | null; branchId?: number | null }) => ({
              collegeId: s?.collegeId == null || (s?.collegeId as unknown) === "" ? null : Number(s.collegeId),
              branchId: s?.branchId == null || (s?.branchId as unknown) === "" ? null : Number(s.branchId),
            }),
          )
        : undefined;

      const user = await linkHrmsUser({
        hrmsUserId,
        roleKey,
        collegeId: body.collegeId === null || body.collegeId === undefined ? null : Number(body.collegeId),
        branchId: body.branchId === null || body.branchId === undefined ? null : Number(body.branchId),
        scopes,
        isActive: body.isActive !== false,
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.status(201).json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.put(
  "/:id/roles",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = paramId(req.params.id);
      const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
      if (!assignments) {
        res.status(400).json({ message: "assignments array is required" });
        return;
      }
      const user = await replaceUserRoles({
        userId,
        assignments: assignments.map(
          (a: { roleKey?: string; collegeId?: number | null; branchId?: number | null }) => ({
            roleKey: String(a.roleKey ?? ""),
            collegeId: a.collegeId == null || (a.collegeId as unknown) === "" ? null : Number(a.collegeId),
            branchId: a.branchId == null || (a.branchId as unknown) === "" ? null : Number(a.branchId),
          }),
        ),
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.put(
  "/:id/scope",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = paramId(req.params.id);
      const assignmentId = Number(req.body?.assignmentId);
      if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
        res.status(400).json({ message: "assignmentId is required" });
        return;
      }
      const user = await updateUserAssignmentScope({
        userId,
        assignmentId,
        collegeId:
          req.body?.collegeId == null || req.body?.collegeId === ""
            ? null
            : Number(req.body.collegeId),
        branchId:
          req.body?.branchId == null || req.body?.branchId === ""
            ? null
            : Number(req.body.branchId),
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.put(
  "/:id/profile",
  requirePermission("user_management.view", "user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = paramId(req.params.id);
      const body = req.body ?? {};
      const user = await updateManagedUserProfile({
        userId,
        actorUserId: req.authUser!.id,
        name: body.name,
        email: body.email,
        username: body.username,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        ipAddress: req.ip,
      });
      res.json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.delete(
  "/:id",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await deleteManagedUser({
        userId: paramId(req.params.id),
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.json(result);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.put(
  "/:id/status",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = paramId(req.params.id);
      if (typeof req.body?.isActive !== "boolean") {
        res.status(400).json({ message: "isActive (boolean) is required" });
        return;
      }
      const user = await setUserActiveStatus({
        userId,
        isActive: req.body.isActive,
        actorUserId: req.authUser!.id,
        ipAddress: req.ip,
      });
      res.json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);

usersRouter.put(
  "/:id/permissions",
  requirePermission("user_management.manage_users"),
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = paramId(req.params.id);
      if (!Array.isArray(req.body?.permissions)) {
        res.status(400).json({ message: "permissions array is required" });
        return;
      }
      const revoked = Array.isArray(req.body?.revokedPermissions) ? req.body.revokedPermissions : [];
      await setUserPermissions(userId, req.body.permissions, revoked, req.authUser!.id);
      const user = await getManagedUser(userId);
      res.json(user);
    } catch (error) {
      sendError(res, error, next);
    }
  },
);
