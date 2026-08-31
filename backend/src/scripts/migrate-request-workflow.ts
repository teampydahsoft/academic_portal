/**
 * Migrate request workflow tables and seed default configuration.
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
    CREATE TABLE IF NOT EXISTS ap_request_types (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      type_key VARCHAR(64) NOT NULL,
      label VARCHAR(255) NOT NULL,
      description TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_request_type_key (type_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await executeAcademic(`
    CREATE TABLE IF NOT EXISTS ap_request_workflows (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      request_type_id INT UNSIGNED NOT NULL,
      workflow_key VARCHAR(64) NOT NULL,
      label VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_request_workflow (request_type_id, workflow_key),
      CONSTRAINT fk_rw_type FOREIGN KEY (request_type_id) REFERENCES ap_request_types(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await executeAcademic(`
    CREATE TABLE IF NOT EXISTS ap_request_workflow_steps (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      workflow_id INT UNSIGNED NOT NULL,
      step_order INT NOT NULL,
      step_key VARCHAR(64) NOT NULL,
      label VARCHAR(255) NOT NULL,
      approver_role_key VARCHAR(64) NULL,
      required_permission VARCHAR(100) NULL,
      scope_mode ENUM('requester_scope','same_college','same_branch','global') NOT NULL DEFAULT 'requester_scope',
      allow_escalate TINYINT(1) NOT NULL DEFAULT 0,
      is_final TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_workflow_step_order (workflow_id, step_order),
      UNIQUE KEY uq_workflow_step_key (workflow_id, step_key),
      CONSTRAINT fk_rws_workflow FOREIGN KEY (workflow_id) REFERENCES ap_request_workflows(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await executeAcademic(`
    CREATE TABLE IF NOT EXISTS ap_requests (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      request_type_id INT UNSIGNED NOT NULL,
      workflow_id INT UNSIGNED NOT NULL,
      requester_user_id BIGINT UNSIGNED NOT NULL,
      college_id INT NULL,
      branch_id INT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NULL,
      status ENUM(
        'draft',
        'submitted',
        'pending_approval',
        'approved',
        'rejected',
        'returned',
        'cancelled'
      ) NOT NULL DEFAULT 'draft',
      current_step_id INT UNSIGNED NULL,
      current_step_order INT NULL,
      submitted_at DATETIME NULL,
      closed_at DATETIME NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_requests_requester (requester_user_id, status),
      KEY idx_requests_scope (college_id, branch_id, status),
      KEY idx_requests_pending (status, current_step_id),
      CONSTRAINT fk_req_type FOREIGN KEY (request_type_id) REFERENCES ap_request_types(id),
      CONSTRAINT fk_req_workflow FOREIGN KEY (workflow_id) REFERENCES ap_request_workflows(id),
      CONSTRAINT fk_req_requester FOREIGN KEY (requester_user_id) REFERENCES ap_users(id),
      CONSTRAINT fk_req_step FOREIGN KEY (current_step_id) REFERENCES ap_request_workflow_steps(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await executeAcademic(`
    CREATE TABLE IF NOT EXISTS ap_request_actions (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      request_id BIGINT UNSIGNED NOT NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      action VARCHAR(50) NOT NULL,
      from_status VARCHAR(50) NULL,
      to_status VARCHAR(50) NULL,
      step_id INT UNSIGNED NULL,
      step_order INT NULL,
      comment TEXT NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_request_actions_request (request_id, created_at),
      CONSTRAINT fk_ra_request FOREIGN KEY (request_id) REFERENCES ap_requests(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function seedDefaultWorkflow() {
  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_request_types WHERE type_key = 'general_academic' LIMIT 1`,
  );
  if (existing[0]) {
    console.log("Default request workflow already seeded — skipping");
    return;
  }

  const typeResult = await executeAcademic(
    `
    INSERT INTO ap_request_types (type_key, label, description, is_active)
    VALUES (
      'general_academic',
      'General Academic Request',
      'Standard academic request routed through configured approval hierarchy',
      1
    )
    `,
  );
  const typeId = Number(typeResult.insertId);

  const workflowResult = await executeAcademic(
    `
    INSERT INTO ap_request_workflows (request_type_id, workflow_key, label, is_active)
    VALUES (?, 'default_hierarchy', 'Default Academic Approval Hierarchy', 1)
    `,
    [typeId],
  );
  const workflowId = Number(workflowResult.insertId);

  const steps = [
    {
      step_order: 1,
      step_key: "hod_review",
      label: "HOD Review",
      approver_role_key: "hod",
      required_permission: "request.approve",
      scope_mode: "same_branch",
      allow_escalate: 0,
      is_final: 0,
    },
    {
      step_order: 2,
      step_key: "principal_review",
      label: "Principal Review",
      approver_role_key: "principal",
      required_permission: "request.approve",
      scope_mode: "same_college",
      allow_escalate: 0,
      is_final: 0,
    },
    {
      step_order: 3,
      step_key: "management_review",
      label: "Management Review",
      approver_role_key: "management",
      required_permission: "request.approve",
      scope_mode: "global",
      allow_escalate: 0,
      is_final: 1,
    },
  ];

  for (const step of steps) {
    await executeAcademic(
      `
      INSERT INTO ap_request_workflow_steps
        (workflow_id, step_order, step_key, label, approver_role_key, required_permission,
         scope_mode, allow_escalate, is_final)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        workflowId,
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

  console.log("Seeded default general_academic workflow with 3 steps");
}

async function main() {
  console.log("=== Request workflow migration ===\n");

  await ensureTables();

  const tables = [
    "ap_request_types",
    "ap_request_workflows",
    "ap_request_workflow_steps",
    "ap_requests",
    "ap_request_actions",
  ];
  for (const table of tables) {
    console.log(`${table}: ${(await tableExists(table)) ? "ok" : "missing"}`);
  }

  await seedDefaultWorkflow();
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
