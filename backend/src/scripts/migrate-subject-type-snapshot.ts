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

  const tables: Array<[string, string]> = [
    [
      "ap_timetable_entries",
      "ADD COLUMN subject_type_snapshot VARCHAR(20) NULL AFTER subject_name",
    ],
    [
      "ap_class_sessions",
      "ADD COLUMN subject_type_snapshot VARCHAR(20) NULL AFTER subject_name",
    ],
  ];

  for (const [table, clause] of tables) {
    if (!(await columnExists(connection, table, "subject_type_snapshot"))) {
      await connection.query(`ALTER TABLE ${table} ${clause}`);
      console.log(`Added ${table}.subject_type_snapshot`);
    } else {
      console.log(`${table}.subject_type_snapshot already exists`);
    }
  }

  await connection.end();
  console.log("Subject type snapshot migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
