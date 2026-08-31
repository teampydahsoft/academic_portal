/**
 * Faculty substitution workflow verification.
 * Requires API server, request workflow migration, and faculty substitution migration.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { queryAcademic } from "../db/pools.js";

const base = `http://127.0.0.1:${env.port}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

async function main() {
  console.log("=== Faculty substitution verification ===\n");

  const typeRows = await queryAcademic<(RowDataPacket & { type_key: string })[]>(
    `SELECT type_key FROM ap_request_types WHERE type_key = 'faculty_substitution' LIMIT 1`,
  );
  assert(typeRows[0], "faculty_substitution request type must exist — run db:migrate:faculty-substitution");
  console.log("1. Request type seeded");

  const tables = ["ap_faculty_substitution_details", "ap_class_session_substitutions"];
  for (const table of tables) {
    const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `
      SELECT COUNT(*) AS c
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      `,
      [table],
    );
    assert(Number(rows[0]?.c) > 0, `${table} must exist`);
  }
  console.log("2. Substitution tables exist");

  const workflowRows = await queryAcademic<(RowDataPacket & { step_count: number })[]>(
    `
    SELECT COUNT(s.id) AS step_count
    FROM ap_request_types t
    INNER JOIN ap_request_workflows w ON w.request_type_id = t.id AND w.is_active = 1
    LEFT JOIN ap_request_workflow_steps s ON s.workflow_id = w.id
    WHERE t.type_key = 'faculty_substitution'
    GROUP BY t.id
    `,
  );
  assert(Number(workflowRows[0]?.step_count ?? 0) > 0, "faculty_substitution workflow must have steps");
  console.log("3. Active workflow configured");

  const unauthorized = await req("/api/faculty-substitutions/periods?sessionDate=2026-08-31");
  assert(unauthorized.status === 401, `Unauthenticated expected 401, got ${unauthorized.status}`);
  console.log("4. Unauthenticated access blocked");

  const general = await queryAcademic<(RowDataPacket & { type_key: string })[]>(
    `SELECT type_key FROM ap_request_types WHERE type_key = 'general_academic' LIMIT 1`,
  );
  assert(general[0], "general_academic must remain");
  console.log("5. Existing general_academic request type preserved");

  console.log("\nFaculty substitution foundation checks passed.");
  console.log("Full E2E substitution apply tests require published timetable + class session data.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
