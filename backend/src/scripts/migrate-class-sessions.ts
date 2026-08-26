import "dotenv/config";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";

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
    connectTimeout: 60000,
    ...(env.academicDb.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  console.log(`Connected to ${env.academicDb.database}`);

  const alters: Array<[string, string]> = [
    [
      "timing_template_id",
      "ADD COLUMN timing_template_id BIGINT UNSIGNED NULL AFTER plan_id",
    ],
    [
      "timing_slot_id",
      "ADD COLUMN timing_slot_id BIGINT UNSIGNED NULL AFTER period_slot_id",
    ],
    ["college_id", "ADD COLUMN college_id INT NULL AFTER plan_id"],
    [
      "academic_year_label",
      "ADD COLUMN academic_year_label VARCHAR(20) NULL AFTER college_id",
    ],
    [
      "semester_number",
      "ADD COLUMN semester_number TINYINT NULL AFTER academic_year_label",
    ],
    ["start_time", "ADD COLUMN start_time TIME NULL AFTER day_of_week"],
    ["end_time", "ADD COLUMN end_time TIME NULL AFTER start_time"],
    [
      "subject_code",
      "ADD COLUMN subject_code VARCHAR(50) NULL AFTER subject_id",
    ],
    [
      "subject_name",
      "ADD COLUMN subject_name VARCHAR(255) NULL AFTER subject_code",
    ],
    [
      "room_label",
      "ADD COLUMN room_label VARCHAR(100) NULL AFTER faculty_staff_link_id",
    ],
    [
      "updated_at",
      "ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
    ],
  ];

  for (const [column, clause] of alters) {
    if (!(await columnExists(connection, "ap_class_sessions", column))) {
      await connection.query(`ALTER TABLE ap_class_sessions ${clause}`);
      console.log(`Added ap_class_sessions.${column}`);
    }
  }

  // Extend status enum with completed (keep posted/holiday for future attendance)
  try {
    await connection.query(`
      ALTER TABLE ap_class_sessions
      MODIFY COLUMN status
        ENUM('scheduled','posted','cancelled','holiday','completed')
        NOT NULL DEFAULT 'scheduled'
    `);
    console.log("Updated ap_class_sessions.status enum");
  } catch (error) {
    console.log("Status enum update skipped/failed:", (error as Error).message);
  }

  // Backfill timing_slot_id from legacy period_slot_id where empty
  await connection.query(`
    UPDATE ap_class_sessions
    SET timing_slot_id = period_slot_id
    WHERE timing_slot_id IS NULL AND period_slot_id IS NOT NULL
  `);

  await connection.end();
  console.log("Class sessions migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
