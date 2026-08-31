/**
 * Migrate faculty substitution tables and seed request type.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";

async function tableExists(table: string) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `,
    [table],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function ensureTables() {
  await executeAcademic(`
    CREATE TABLE IF NOT EXISTS ap_faculty_substitution_details (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      request_id BIGINT UNSIGNED NOT NULL,
      session_date DATE NOT NULL,
      timetable_entry_id BIGINT UNSIGNED NOT NULL,
      plan_id BIGINT UNSIGNED NOT NULL,
      class_session_id BIGINT UNSIGNED NULL,
      college_id INT NOT NULL,
      course_id INT NOT NULL,
      branch_id INT NOT NULL,
      batch VARCHAR(32) NOT NULL,
      year_of_study INT NULL,
      semester_number INT NULL,
      section_name VARCHAR(64) NOT NULL,
      timing_slot_id BIGINT UNSIGNED NOT NULL,
      subject_id INT NULL,
      subject_code VARCHAR(64) NULL,
      subject_name VARCHAR(255) NULL,
      room_label VARCHAR(128) NULL,
      original_faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
      replacement_faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
      reason TEXT NOT NULL,
      execution_status ENUM('pending', 'applied', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
      execution_error TEXT NULL,
      applied_at DATETIME NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_substitution_request (request_id),
      KEY idx_substitution_date_slot (session_date, timing_slot_id, branch_id, section_name),
      KEY idx_substitution_original_faculty (original_faculty_staff_link_id, session_date),
      KEY idx_substitution_replacement_faculty (replacement_faculty_staff_link_id, session_date),
      CONSTRAINT fk_fsd_request FOREIGN KEY (request_id) REFERENCES ap_requests(id),
      CONSTRAINT fk_fsd_entry FOREIGN KEY (timetable_entry_id) REFERENCES ap_timetable_entries(id),
      CONSTRAINT fk_fsd_plan FOREIGN KEY (plan_id) REFERENCES ap_timetable_plans(id),
      CONSTRAINT fk_fsd_original_faculty FOREIGN KEY (original_faculty_staff_link_id) REFERENCES ap_staff_link(id),
      CONSTRAINT fk_fsd_replacement_faculty FOREIGN KEY (replacement_faculty_staff_link_id) REFERENCES ap_staff_link(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await executeAcademic(`
    CREATE TABLE IF NOT EXISTS ap_class_session_substitutions (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      request_id BIGINT UNSIGNED NOT NULL,
      class_session_id BIGINT UNSIGNED NOT NULL,
      session_date DATE NOT NULL,
      timetable_entry_id BIGINT UNSIGNED NOT NULL,
      original_faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
      replacement_faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
      status ENUM('active', 'reversed') NOT NULL DEFAULT 'active',
      applied_at DATETIME NOT NULL,
      applied_by_user_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_css_session_request (class_session_id, request_id),
      KEY idx_css_request (request_id),
      KEY idx_css_date_replacement (session_date, replacement_faculty_staff_link_id),
      CONSTRAINT fk_css_request FOREIGN KEY (request_id) REFERENCES ap_requests(id),
      CONSTRAINT fk_css_session FOREIGN KEY (class_session_id) REFERENCES ap_class_sessions(id),
      CONSTRAINT fk_css_entry FOREIGN KEY (timetable_entry_id) REFERENCES ap_timetable_entries(id),
      CONSTRAINT fk_css_original FOREIGN KEY (original_faculty_staff_link_id) REFERENCES ap_staff_link(id),
      CONSTRAINT fk_css_replacement FOREIGN KEY (replacement_faculty_staff_link_id) REFERENCES ap_staff_link(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function seedRequestType() {
  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_request_types WHERE type_key = 'faculty_substitution' LIMIT 1`,
  );
  if (existing[0]) {
    console.log("faculty_substitution request type already exists — skipping type seed");
    return Number(existing[0].id);
  }

  const typeResult = await executeAcademic(
    `
    INSERT INTO ap_request_types (type_key, label, description, is_active)
    VALUES (
      'faculty_substitution',
      'Faculty Substitution / Class Shifting',
      'Request a temporary faculty replacement for a specific class date and period',
      1
    )
    `,
  );
  const typeId = Number(typeResult.insertId);
  console.log("Seeded faculty_substitution request type");

  const generalWorkflow = await queryAcademic<
    (RowDataPacket & { workflow_id: number; request_type_id: number })[]
  >(
    `
    SELECT w.id AS workflow_id, w.request_type_id
    FROM ap_request_workflows w
    INNER JOIN ap_request_types t ON t.id = w.request_type_id
    WHERE t.type_key = 'general_academic' AND w.is_active = 1
    ORDER BY w.id DESC
    LIMIT 1
    `,
  );

  let sourceWorkflowId = generalWorkflow[0]?.workflow_id ?? null;
  if (!sourceWorkflowId) {
    const workflowResult = await executeAcademic(
      `
      INSERT INTO ap_request_workflows (request_type_id, workflow_key, label, is_active)
      VALUES (?, 'default_hierarchy', 'Default Approval Hierarchy', 1)
      `,
      [typeId],
    );
    sourceWorkflowId = Number(workflowResult.insertId);
    console.log("Created default workflow for faculty_substitution (no general_academic workflow to copy)");
    return typeId;
  }

  const workflowResult = await executeAcademic(
    `
    INSERT INTO ap_request_workflows (request_type_id, workflow_key, label, is_active)
    SELECT ?, workflow_key, label, 1
    FROM ap_request_workflows
    WHERE id = ?
    `,
    [typeId, sourceWorkflowId],
  );
  const newWorkflowId = Number(workflowResult.insertId);

  const steps = await queryAcademic<
    (RowDataPacket & {
      step_order: number;
      step_key: string;
      label: string;
      approver_role_key: string | null;
      required_permission: string | null;
      scope_mode: string;
      allow_escalate: number;
      is_final: number;
    })[]
  >(
    `SELECT * FROM ap_request_workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC`,
    [sourceWorkflowId],
  );

  for (const step of steps) {
    await executeAcademic(
      `
      INSERT INTO ap_request_workflow_steps
        (workflow_id, step_order, step_key, label, approver_role_key, required_permission,
         scope_mode, allow_escalate, is_final)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        newWorkflowId,
        step.step_order,
        step.step_key,
        step.label,
        step.approver_role_key,
        step.required_permission,
        step.scope_mode,
        step.allow_escalate,
        step.is_final,
      ],
    );
  }

  console.log(`Seeded faculty_substitution workflow with ${steps.length} copied steps`);
  return typeId;
}

async function main() {
  console.log("=== Faculty substitution migration ===\n");
  await ensureTables();

  for (const table of ["ap_faculty_substitution_details", "ap_class_session_substitutions"]) {
    console.log(`${table}: ${(await tableExists(table)) ? "ok" : "missing"}`);
  }

  await seedRequestType();
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
