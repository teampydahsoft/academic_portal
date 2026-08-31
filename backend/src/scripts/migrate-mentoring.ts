/**
 * Migrate mentoring & risk management tables (Phase 2).
 * Extends existing ap_mentor_assignments, ap_risk_cases, ap_interventions safely.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";

async function columnExists(table: string, column: string) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `,
    [table, column],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

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

async function addColumn(table: string, ddl: string) {
  await executeAcademic(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

async function ensureMentorAssignments() {
  if (!(await tableExists("ap_mentor_assignments"))) {
    await executeAcademic(`
      CREATE TABLE ap_mentor_assignments (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        student_db_id INT NOT NULL,
        faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
        assigned_by BIGINT UNSIGNED NULL,
        academic_year_label VARCHAR(20) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        notes TEXT NULL,
        deactivated_at DATETIME NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mentor (student_db_id, academic_year_label, faculty_staff_link_id),
        KEY idx_ma_student (student_db_id, is_active),
        KEY idx_ma_faculty (faculty_staff_link_id, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created ap_mentor_assignments");
    return;
  }

  if (!(await columnExists("ap_mentor_assignments", "assigned_by"))) {
    await addColumn("ap_mentor_assignments", "assigned_by BIGINT UNSIGNED NULL AFTER faculty_staff_link_id");
    console.log("Added ap_mentor_assignments.assigned_by");
  }
  if (!(await columnExists("ap_mentor_assignments", "notes"))) {
    await addColumn("ap_mentor_assignments", "notes TEXT NULL AFTER is_active");
    console.log("Added ap_mentor_assignments.notes");
  }
  if (!(await columnExists("ap_mentor_assignments", "deactivated_at"))) {
    await addColumn("ap_mentor_assignments", "deactivated_at DATETIME NULL AFTER notes");
    console.log("Added ap_mentor_assignments.deactivated_at");
  }
  if (!(await columnExists("ap_mentor_assignments", "updated_at"))) {
    await addColumn(
      "ap_mentor_assignments",
      "updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER deactivated_at",
    );
    console.log("Added ap_mentor_assignments.updated_at");
  }
}

async function ensureRiskCases() {
  if (!(await tableExists("ap_risk_cases"))) {
    await executeAcademic(`
      CREATE TABLE ap_risk_cases (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        student_db_id INT NOT NULL,
        risk_type VARCHAR(100) NOT NULL,
        risk_reason TEXT NULL,
        severity ENUM('critical','high','medium','low') NOT NULL,
        status ENUM('open','monitoring','resolved','escalated') NOT NULL DEFAULT 'open',
        opened_at DATETIME NOT NULL,
        opened_by BIGINT UNSIGNED NULL,
        closed_at DATETIME NULL,
        escalated_at DATETIME NULL,
        resolved_at DATETIME NULL,
        assigned_mentor_id BIGINT UNSIGNED NULL,
        academic_year_label VARCHAR(20) NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_rc_student (student_db_id, status),
        KEY idx_rc_status (status, opened_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created ap_risk_cases");
    return;
  }

  const statusCol = await queryAcademic<
    (RowDataPacket & { column_type: string })[]
  >(
    `
    SELECT COLUMN_TYPE AS column_type
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_risk_cases' AND COLUMN_NAME = 'status'
    `,
  );
  const statusType = String(statusCol[0]?.column_type ?? "");
  if (statusType.includes("in_progress") || statusType.includes("closed")) {
    await executeAcademic(`
      ALTER TABLE ap_risk_cases
        MODIFY status ENUM('open','in_progress','closed','escalated','monitoring','resolved') NOT NULL DEFAULT 'open'
    `);
    await executeAcademic(`UPDATE ap_risk_cases SET status = 'monitoring' WHERE status = 'in_progress'`);
    await executeAcademic(`UPDATE ap_risk_cases SET status = 'resolved' WHERE status = 'closed'`);
    await executeAcademic(`
      ALTER TABLE ap_risk_cases
        MODIFY status ENUM('open','monitoring','resolved','escalated') NOT NULL DEFAULT 'open'
    `);
    console.log("Migrated ap_risk_cases.status to open/monitoring/resolved/escalated");
  }

  if (!(await columnExists("ap_risk_cases", "risk_reason"))) {
    await addColumn("ap_risk_cases", "risk_reason TEXT NULL AFTER risk_type");
    console.log("Added ap_risk_cases.risk_reason");
  }
  if (!(await columnExists("ap_risk_cases", "opened_by"))) {
    await addColumn("ap_risk_cases", "opened_by BIGINT UNSIGNED NULL AFTER opened_at");
    console.log("Added ap_risk_cases.opened_by");
  }
  if (!(await columnExists("ap_risk_cases", "escalated_at"))) {
    await addColumn("ap_risk_cases", "escalated_at DATETIME NULL AFTER closed_at");
    console.log("Added ap_risk_cases.escalated_at");
  }
  if (!(await columnExists("ap_risk_cases", "resolved_at"))) {
    await addColumn("ap_risk_cases", "resolved_at DATETIME NULL AFTER escalated_at");
    console.log("Added ap_risk_cases.resolved_at");
  }
  if (!(await columnExists("ap_risk_cases", "academic_year_label"))) {
    await addColumn("ap_risk_cases", "academic_year_label VARCHAR(20) NULL AFTER assigned_mentor_id");
    console.log("Added ap_risk_cases.academic_year_label");
  }
  if (!(await columnExists("ap_risk_cases", "updated_at"))) {
    await addColumn(
      "ap_risk_cases",
      "updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
    );
    console.log("Added ap_risk_cases.updated_at");
  }
}

async function ensureInterventions() {
  if (!(await tableExists("ap_interventions"))) {
    await executeAcademic(`
      CREATE TABLE ap_interventions (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        risk_case_id BIGINT UNSIGNED NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        notes TEXT NULL,
        outcome VARCHAR(255) NULL,
        follow_up_date DATE NULL,
        action_by BIGINT UNSIGNED NULL,
        action_at DATETIME NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_int_case (risk_case_id, action_at),
        CONSTRAINT fk_int_risk FOREIGN KEY (risk_case_id) REFERENCES ap_risk_cases(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created ap_interventions");
    return;
  }

  if (!(await columnExists("ap_interventions", "outcome"))) {
    await addColumn("ap_interventions", "outcome VARCHAR(255) NULL AFTER notes");
    console.log("Added ap_interventions.outcome");
  }
  if (!(await columnExists("ap_interventions", "follow_up_date"))) {
    await addColumn("ap_interventions", "follow_up_date DATE NULL AFTER outcome");
    console.log("Added ap_interventions.follow_up_date");
  }
  if (!(await columnExists("ap_interventions", "updated_at"))) {
    await addColumn(
      "ap_interventions",
      "updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
    );
    console.log("Added ap_interventions.updated_at");
  }
}

async function ensureRiskCaseEvents() {
  if (await tableExists("ap_risk_case_events")) {
    console.log("ap_risk_case_events already exists");
    return;
  }
  await executeAcademic(`
    CREATE TABLE ap_risk_case_events (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      risk_case_id BIGINT UNSIGNED NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      old_status VARCHAR(32) NULL,
      new_status VARCHAR(32) NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_rce_case (risk_case_id, created_at),
      CONSTRAINT fk_rce_case FOREIGN KEY (risk_case_id) REFERENCES ap_risk_cases(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Created ap_risk_case_events");
}

async function main() {
  console.log("=== Mentoring & Risk migration ===\n");
  await ensureMentorAssignments();
  await ensureRiskCases();
  await ensureInterventions();
  await ensureRiskCaseEvents();
  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
