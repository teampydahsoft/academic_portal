import { Router } from "express";
import type { Response } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { loadAuthzContext } from "../authz/authorization.service.js";
import {
  clearSessionCookieOptions,
  getSessionCookieName,
  loginWithCredentials,
  revokeSessionToken,
  sessionCookieOptions,
} from "../services/auth.service.js";
import {
  getLoginThrottleRetryAfter,
  recordFailedLoginAttempt,
} from "../middleware/login-rate-limit.js";

export const authRouter = Router();

export function sendCurrentUser(req: AuthedRequest, res: Response) {
  const user = req.authUser!;
  const authz = req.authz;
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      hrmsEmployeeId: user.hrmsEmployeeId,
      hrmsUserId: user.hrmsUserId,
    },
    authorization: {
      roles: (authz?.roles ?? []).map((role) => ({
        roleKey: role.roleKey,
        label: role.label,
        collegeId: role.collegeId,
        branchId: role.branchId,
      })),
      permissions: authz?.permissions ?? [],
      scope: authz?.scope ?? {
        isGlobal: false,
        collegeIds: [],
        branchIds: [],
      },
    },
  });
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const retryAfter = getLoginThrottleRetryAfter(req.ip);
    if (retryAfter != null) {
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        message: "Too many login attempts. Please try again later.",
      });
      return;
    }

    const identifier = String(req.body?.identifier ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    const result = await loginWithCredentials({
      identifier,
      password,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    const authz = await loadAuthzContext(result.user.id);
    res.cookie(getSessionCookieName(), result.sessionToken, sessionCookieOptions(result.expiresAt));
    res.json({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        username: result.user.username,
        hrmsEmployeeId: result.user.hrmsEmployeeId,
        hrmsUserId: result.user.hrmsUserId,
      },
      authorization: {
        roles: authz.roles.map((role) => ({
          roleKey: role.roleKey,
          label: role.label,
          collegeId: role.collegeId,
          branchId: role.branchId,
        })),
        permissions: authz.permissions,
        scope: authz.scope,
      },
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) {
      if (status === 401) {
        const recorded = recordFailedLoginAttempt(req.ip);
        if (recorded.throttled) {
          res.setHeader("Retry-After", String(recorded.retryAfterSec));
          res.status(429).json({
            message: "Too many login attempts. Please try again later.",
          });
          return;
        }
      }
      res.status(status).json({
        message: error instanceof Error ? error.message : "Login failed",
      });
      return;
    }
    next(error);
  }
});

authRouter.post("/logout", async (req: AuthedRequest, res, next) => {
  try {
    await revokeSessionToken(req.sessionToken);
    res.cookie(getSessionCookieName(), "", clearSessionCookieOptions());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, sendCurrentUser);
