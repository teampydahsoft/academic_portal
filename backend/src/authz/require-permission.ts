import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  assertEntityInScope,
  enforceAcademicScope,
  hasAnyPermission,
  hasPermission,
  type AuthzContext,
  type ScopeFilters,
} from "./authorization.service.js";
import type { Permission } from "./permissions.js";

export function requirePermission(...permissions: Array<Permission | string>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (!req.authz || !hasAnyPermission(req.authz, permissions)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };
}

export function requireAllPermissions(...permissions: Array<Permission | string>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (!req.authz || !permissions.every((p) => hasPermission(req.authz, p))) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };
}

export function getAuthz(req: AuthedRequest): AuthzContext {
  if (!req.authUser || !req.authz) {
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  }
  return req.authz;
}

export function scopedFilters(req: AuthedRequest, requested: ScopeFilters = {}) {
  return enforceAcademicScope(getAuthz(req), requested);
}

export function ensureEntityScope(
  req: AuthedRequest,
  entity: { collegeId?: number | null; branchId?: number | null },
) {
  assertEntityInScope(getAuthz(req), entity);
}

export function statusFromAuthzError(error: unknown): number {
  return Number((error as { status?: number }).status) || 500;
}
