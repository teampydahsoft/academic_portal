import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic, withAcademicTransaction } from "../db/pools.js";

let tableReady: Promise<void> | null = null;

async function ensureComplaintTypesTable() {
  if (!tableReady) {
    tableReady = executeAcademic(`
      CREATE TABLE IF NOT EXISTS ap_complaint_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY idx_complaint_type_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).then(() => undefined);
  }
  await tableReady;
}

export type ComplaintType = {
  id: number;
  name: string;
  enabled: boolean;
};

export async function getComplaintTypes(): Promise<ComplaintType[]> {
  await ensureComplaintTypesTable();
  const rows = await queryAcademic<(RowDataPacket & { id: number; name: string; is_enabled: number })[]>(
    `SELECT id, name, is_enabled FROM ap_complaint_types ORDER BY name ASC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    enabled: Number(row.is_enabled) === 1,
  }));
}

export async function saveComplaintTypes(
  types: { id?: number; name: string; enabled: boolean }[]
): Promise<ComplaintType[]> {
  await ensureComplaintTypesTable();
  
  await withAcademicTransaction(async (conn) => {
    const validIds = types.map((t) => t.id).filter((id): id is number => id != null && !Number.isNaN(id));
    if (validIds.length > 0) {
      const placeholders = validIds.map(() => "?").join(", ");
      await conn.query(`DELETE FROM ap_complaint_types WHERE id NOT IN (${placeholders})`, validIds);
    } else {
      await conn.query(`DELETE FROM ap_complaint_types`);
    }

    for (const type of types) {
      const name = (type.name || "").trim();
      if (!name) continue;
      
      if (type.id) {
        await conn.query(
          `UPDATE ap_complaint_types SET name = ?, is_enabled = ? WHERE id = ?`,
          [name, type.enabled ? 1 : 0, type.id]
        );
      } else {
        await conn.query(
          `INSERT INTO ap_complaint_types (name, is_enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
          [name, type.enabled ? 1 : 0]
        );
      }
    }
  });

  return getComplaintTypes();
}
