import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "../services/auth.service.js";
import { getUserForSessionToken } from "../services/auth.service.js";
import { loadAuthzContext, type AuthzContext } from "../authz/authorization.service.js";
import { env } from "../config/env.js";

export type AuthedRequest = Request & {
  authUser?: AuthUser | null;
  authz?: AuthzContext | null;
  sessionToken?: string | null;
};

function readSessionToken(req: Request): string | null {
  const fromCookie = req.cookies?.[env.auth.cookieName];
  if (typeof fromCookie === "string" && fromCookie.trim()) {
    return fromCookie.trim();
  }
  return null;
}

/** Attach authUser + authz when a valid session cookie is present. Never trusts client role claims. */
export async function loadSession(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = readSessionToken(req);
    req.sessionToken = token;
    if (!token) {
      req.authUser = null;
      req.authz = null;
      next();
      return;
    }
    const user = await getUserForSessionToken(token);
    req.authUser = user;
    req.authz = user ? await loadAuthzContext(user.id) : null;
    next();
  } catch (error) {
    next(error);
  }
}

/** Reject unauthenticated requests. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  next();
}
