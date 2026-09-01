import type { RowDataPacket } from "mysql2";
import { queryAcademic } from "../db/pools.js";
import type { AuthzContext } from "./authorization.service.js";

const INSTITUTE_WIDE_PERMISSIONS = [
  "timetable.edit",
  "timetable.publish",
  "user_management.manage_users",
  "settings.edit",
  "mentoring.manage",
] as const;

export async function resolveStaffLinkIdForUser(userId: number): Promise<number | null> {
  const rows = await queryAcademic<(RowDataPacket & { staff_link_id: number | null })[]>(
    `
    SELECT sl.id AS staff_link_id
    FROM ap_users u
    LEFT JOIN ap_staff_link sl ON sl.hrms_employee_id = u.hrms_employee_id
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId],
  );
  const id = rows[0]?.staff_link_id;
  return id != null ? Number(id) : null;
}

/** Faculty / teaching staff without institute-wide admin permissions. */
export function shouldRestrictToOwnTeachingLoad(authz: AuthzContext): boolean {
  const hasTeachingAccess =
    authz.permissions.includes("attendance.view") ||
    authz.permissions.includes("attendance.post") ||
    authz.permissions.includes("my_timetable.view");
  if (!hasTeachingAccess) return false;
  return !INSTITUTE_WIDE_PERMISSIONS.some((key) => authz.permissions.includes(key));
}

export async function ownTeachingStaffLinkId(
  authz: AuthzContext,
): Promise<number | null | undefined> {
  if (!shouldRestrictToOwnTeachingLoad(authz)) return undefined;
  const staffLinkId = await resolveStaffLinkIdForUser(authz.userId);
  return staffLinkId ?? null;
}
