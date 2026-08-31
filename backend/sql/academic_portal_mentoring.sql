-- Mentoring & Risk Management extensions (Phase 2)
-- Applied by: npm run db:migrate:mentoring

-- Mentor assignments: track who assigned and deactivation
ALTER TABLE ap_mentor_assignments
  ADD COLUMN IF NOT EXISTS assigned_by BIGINT UNSIGNED NULL AFTER faculty_staff_link_id,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL AFTER is_active,
  ADD COLUMN IF NOT EXISTS deactivated_at DATETIME NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER deactivated_at;

-- Risk cases: lifecycle fields and audit metadata
ALTER TABLE ap_risk_cases
  ADD COLUMN IF NOT EXISTS risk_reason TEXT NULL AFTER risk_type,
  ADD COLUMN IF NOT EXISTS opened_by BIGINT UNSIGNED NULL AFTER opened_at,
  ADD COLUMN IF NOT EXISTS academic_year_label VARCHAR(20) NULL AFTER assigned_mentor_id,
  ADD COLUMN IF NOT EXISTS escalated_at DATETIME NULL AFTER closed_at,
  ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL AFTER escalated_at,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- Interventions: outcome and follow-up
ALTER TABLE ap_interventions
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(255) NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS follow_up_date DATE NULL AFTER outcome,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE TABLE IF NOT EXISTS ap_risk_case_events (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
