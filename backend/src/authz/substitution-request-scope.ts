import type { AuthzContext } from "./authorization.service.js";

/** Roles that may search employees and raise substitution requests on their behalf. */
export const SUBSTITUTION_DELEGATE_ROLE_KEYS = [
  "super_admin",
  "principal",
  "vice_principal",
  "hod",
] as const;

export function canRaiseSubstitutionForOthers(authz: AuthzContext): boolean {
  return authz.roleKeys.some((key) =>
    (SUBSTITUTION_DELEGATE_ROLE_KEYS as readonly string[]).includes(key),
  );
}

/** Teaching staff (staff role) without delegation — own classes only. */
export function mustRaiseOwnSubstitutionOnly(authz: AuthzContext): boolean {
  if (canRaiseSubstitutionForOthers(authz)) return false;
  return authz.roleKeys.includes("staff");
}
