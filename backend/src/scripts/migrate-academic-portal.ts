import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function columnExists(
  connection: mysql.Connection,
  table: string,
  column: string,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `,
    [env.academicDb.database, table, column],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function main() {
  const connection = await mysql.createConnection({
    host: env.academicDb.host,
    port: env.academicDb.port,
    user: env.academicDb.user,
    password: env.academicDb.password,
    database: env.academicDb.database,
    multipleStatements: true,
    connectTimeout: 60000,
    ...(env.academicDb.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  console.log(`Connected to ${env.academicDb.database} @ ${env.academicDb.host}`);

  const baseSql = fs.readFileSync(
    path.resolve(__dirname, "../../sql/academic_portal_schema.sql"),
    "utf8",
  );
  await connection.query(baseSql);

  const timingSql = fs.readFileSync(
    path.resolve(__dirname, "../../sql/academic_portal_timing.sql"),
    "utf8",
  );
  await connection.query(timingSql);

  if (!(await columnExists(connection, "ap_timetable_plans", "timing_template_id"))) {
    await connection.query(`
      ALTER TABLE ap_timetable_plans
        ADD COLUMN timing_template_id BIGINT UNSIGNED NULL AFTER section_name,
        ADD KEY idx_plan_timing (timing_template_id)
    `);
    console.log("Added ap_timetable_plans.timing_template_id");
  }

  // period_slot_id now stores ap_timing_template_slots.id (portal-owned)
  if (!(await columnExists(connection, "ap_timetable_entries", "timing_slot_id"))) {
    await connection.query(`
      ALTER TABLE ap_timetable_entries
        ADD COLUMN timing_slot_id BIGINT UNSIGNED NULL AFTER day_of_week
    `);
    console.log("Added ap_timetable_entries.timing_slot_id");
  }

  // Backfill timing_slot_id from legacy period_slot_id when empty
  await connection.query(`
    UPDATE ap_timetable_entries
    SET timing_slot_id = period_slot_id
    WHERE timing_slot_id IS NULL AND period_slot_id IS NOT NULL
  `);

  const [tables] = await connection.query<RowDataPacket[]>(
    `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME
    `,
    [env.academicDb.database],
  );

  console.log("Tables now present:");
  for (const row of tables) {
    console.log(`- ${row.TABLE_NAME}`);
  }

  await connection.end();
  console.log("Migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
