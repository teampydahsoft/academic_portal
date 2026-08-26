import { executeAcademic } from "../db/pools.js";

export type AuditLogInput = {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
};

/** Append-only audit entry. Never pass passwords or session tokens. */
export async function writeAuditLog(input: AuditLogInput) {
  await executeAcademic(
    `
    INSERT INTO ap_audit_logs
      (actor_user_id, action, entity_type, entity_id, old_value_json, new_value_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.oldValue == null ? null : JSON.stringify(input.oldValue),
      input.newValue == null ? null : JSON.stringify(input.newValue),
      input.ipAddress ?? null,
    ],
  );
}
