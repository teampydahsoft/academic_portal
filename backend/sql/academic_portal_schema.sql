-- Academic Portal writable schema
-- Database: academic_portal (already created on RDS)

CREATE TABLE IF NOT EXISTS ap_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(20) NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  hrms_employee_id VARCHAR(64) NULL,
  rbac_user_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ap_users_hrms (hrms_employee_id),
  KEY idx_ap_users_rbac (rbac_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_roles (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  role_key VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_user_roles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  college_id INT NULL,
  branch_id INT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role_scope (user_id, role_id, college_id, branch_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES ap_users(id),
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES ap_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Opaque session tokens (raw token in HTTP-only cookie; only SHA-256 hash stored)
CREATE TABLE IF NOT EXISTS ap_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  session_token_hash CHAR(64) NOT NULL,
  hrms_user_id VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ap_session_token_hash (session_token_hash),
  KEY idx_ap_sessions_user (user_id),
  KEY idx_ap_sessions_expires (expires_at),
  CONSTRAINT fk_ap_sessions_user FOREIGN KEY (user_id) REFERENCES ap_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_student_link (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_db_id INT NOT NULL,
  admission_number VARCHAR(100) NOT NULL,
  roll_number VARCHAR(30) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_db_id (student_db_id),
  UNIQUE KEY uq_admission (admission_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_staff_link (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  hrms_employee_id VARCHAR(64) NOT NULL,
  employee_code VARCHAR(64) NULL,
  display_name VARCHAR(255) NULL,
  department_name VARCHAR(255) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hrms_employee (hrms_employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_sync_exceptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  source_system ENUM('student_database','examination_portal','hrms') NOT NULL,
  exception_type VARCHAR(100) NOT NULL,
  reference_key VARCHAR(255) NULL,
  payload_json JSON NULL,
  status ENUM('open','resolved','ignored') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  KEY idx_sync_status (status, source_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_timetable_plans (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  academic_year_label VARCHAR(20) NOT NULL,
  college_id INT NOT NULL,
  course_id INT NOT NULL,
  branch_id INT NOT NULL,
  batch VARCHAR(32) NOT NULL,
  year_of_study TINYINT NULL,
  semester_number TINYINT NULL,
  section_name VARCHAR(64) NULL,
  status ENUM('draft','in_review','published','superseded','archived') NOT NULL DEFAULT 'draft',
  version_no INT NOT NULL DEFAULT 1,
  published_at DATETIME NULL,
  published_by BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_plan_scope (academic_year_label, college_id, course_id, branch_id, batch, section_name),
  KEY idx_plan_status (status, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_timetable_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  day_of_week ENUM('MON','TUE','WED','THUR','FRI','SAT','SUN') NOT NULL,
  period_slot_id INT NOT NULL,
  subject_id INT NULL,
  subject_code VARCHAR(50) NULL,
  subject_name VARCHAR(255) NULL,
  subject_type_snapshot VARCHAR(20) NULL,
  entry_type ENUM('theory','lab','break','other') NOT NULL DEFAULT 'theory',
  faculty_staff_link_id BIGINT UNSIGNED NULL,
  room_label VARCHAR(100) NULL,
  span TINYINT NOT NULL DEFAULT 1,
  custom_label VARCHAR(255) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plan_day_period (plan_id, day_of_week, period_slot_id),
  KEY idx_entry_faculty (faculty_staff_link_id),
  CONSTRAINT fk_tte_plan FOREIGN KEY (plan_id) REFERENCES ap_timetable_plans(id),
  CONSTRAINT fk_tte_faculty FOREIGN KEY (faculty_staff_link_id) REFERENCES ap_staff_link(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_timetable_versions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  action ENUM('created','submitted','published','edited','superseded','archived') NOT NULL,
  action_by BIGINT UNSIGNED NULL,
  reason VARCHAR(500) NULL,
  snapshot_json JSON NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ttv_plan FOREIGN KEY (plan_id) REFERENCES ap_timetable_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_faculty_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  academic_year_label VARCHAR(20) NOT NULL,
  branch_id INT NOT NULL,
  batch VARCHAR(32) NOT NULL,
  year_of_study TINYINT NULL,
  semester_number TINYINT NULL,
  section_name VARCHAR(64) NULL,
  subject_id INT NOT NULL,
  faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fac_assign (academic_year_label, branch_id, batch, section_name, subject_id),
  CONSTRAINT fk_fa_staff FOREIGN KEY (faculty_staff_link_id) REFERENCES ap_staff_link(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_workload_thresholds (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  college_id INT NULL,
  branch_id INT NULL,
  min_periods_per_week INT NOT NULL DEFAULT 8,
  max_periods_per_week INT NOT NULL DEFAULT 20,
  max_periods_per_day INT NOT NULL DEFAULT 5,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_workload_snapshots (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  academic_year_label VARCHAR(20) NOT NULL,
  faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
  periods_per_week INT NOT NULL DEFAULT 0,
  subjects_count INT NOT NULL DEFAULT 0,
  sections_count INT NOT NULL DEFAULT 0,
  theory_periods INT NOT NULL DEFAULT 0,
  lab_periods INT NOT NULL DEFAULT 0,
  overload_flag TINYINT(1) NOT NULL DEFAULT 0,
  underload_flag TINYINT(1) NOT NULL DEFAULT 0,
  computed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workload (academic_year_label, faculty_staff_link_id),
  CONSTRAINT fk_ws_staff FOREIGN KEY (faculty_staff_link_id) REFERENCES ap_staff_link(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_class_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  timetable_entry_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  college_id INT NULL,
  academic_year_label VARCHAR(20) NULL,
  semester_number TINYINT NULL,
  timing_template_id BIGINT UNSIGNED NULL,
  session_date DATE NOT NULL,
  day_of_week ENUM('MON','TUE','WED','THUR','FRI','SAT','SUN') NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  period_slot_id INT NOT NULL,
  timing_slot_id BIGINT UNSIGNED NULL,
  section_name VARCHAR(64) NULL,
  branch_id INT NOT NULL,
  subject_id INT NULL,
  subject_code VARCHAR(50) NULL,
  subject_name VARCHAR(255) NULL,
  subject_type_snapshot VARCHAR(20) NULL,
  faculty_staff_link_id BIGINT UNSIGNED NULL,
  room_label VARCHAR(100) NULL,
  status ENUM('scheduled','posted','cancelled','holiday','completed') NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_class_session (timetable_entry_id, session_date),
  KEY idx_session_faculty_date (faculty_staff_link_id, session_date),
  KEY idx_session_status_date (status, session_date),
  KEY idx_session_college_date (college_id, session_date),
  CONSTRAINT fk_cs_entry FOREIGN KEY (timetable_entry_id) REFERENCES ap_timetable_entries(id),
  CONSTRAINT fk_cs_plan FOREIGN KEY (plan_id) REFERENCES ap_timetable_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_attendance_posts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  class_session_id BIGINT UNSIGNED NOT NULL UNIQUE,
  posted_by_user_id BIGINT UNSIGNED NOT NULL,
  posted_by_staff_link_id BIGINT UNSIGNED NOT NULL,
  posted_at DATETIME NOT NULL,
  present_count INT NOT NULL DEFAULT 0,
  absent_count INT NOT NULL DEFAULT 0,
  od_count INT NOT NULL DEFAULT 0,
  leave_count INT NOT NULL DEFAULT 0,
  is_locked TINYINT(1) NOT NULL DEFAULT 1,
  edit_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ap_session FOREIGN KEY (class_session_id) REFERENCES ap_class_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_attendance_post_students (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  attendance_post_id BIGINT UNSIGNED NOT NULL,
  student_db_id INT NOT NULL,
  admission_number VARCHAR(100) NOT NULL,
  status ENUM('present','absent','od','leave') NOT NULL,
  remarks VARCHAR(255) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_post_student (attendance_post_id, student_db_id),
  KEY idx_aps_student (student_db_id, status),
  CONSTRAINT fk_aps_post FOREIGN KEY (attendance_post_id) REFERENCES ap_attendance_posts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_pending_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  category VARCHAR(100) NOT NULL,
  priority ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  title VARCHAR(255) NOT NULL,
  reference_type VARCHAR(100) NULL,
  reference_id BIGINT UNSIGNED NULL,
  assigned_user_id BIGINT UNSIGNED NULL,
  status ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open',
  due_at DATETIME NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  KEY idx_pending_status (status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_thresholds (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  key_name VARCHAR(100) NOT NULL UNIQUE,
  key_value VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which HRMS employee groups appear on Faculty & Departments
CREATE TABLE IF NOT EXISTS ap_faculty_enabled_groups (
  hrms_group_id VARCHAR(64) NOT NULL PRIMARY KEY,
  group_name VARCHAR(255) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_faculty_group_enabled (is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_alerts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  alert_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  severity ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  target_user_id BIGINT UNSIGNED NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_mentor_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_db_id INT NOT NULL,
  faculty_staff_link_id BIGINT UNSIGNED NOT NULL,
  academic_year_label VARCHAR(20) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mentor (student_db_id, academic_year_label, faculty_staff_link_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_risk_cases (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_db_id INT NOT NULL,
  risk_type VARCHAR(100) NOT NULL,
  severity ENUM('critical','high','medium','low') NOT NULL,
  status ENUM('open','in_progress','closed','escalated') NOT NULL DEFAULT 'open',
  opened_at DATETIME NOT NULL,
  closed_at DATETIME NULL,
  assigned_mentor_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_interventions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  risk_case_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  notes TEXT NULL,
  action_by BIGINT UNSIGNED NULL,
  action_at DATETIME NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_int_risk FOREIGN KEY (risk_case_id) REFERENCES ap_risk_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ap_audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  old_value_json JSON NULL,
  new_value_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_actor (actor_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ap_roles (role_key, label, description) VALUES
  ('management', 'Management', 'Full dashboard visibility'),
  ('principal', 'Principal', 'Institution oversight'),
  ('academic_admin', 'Academic Administrator', 'Timetable publish and configs'),
  ('hod', 'Head of Department', 'Department timetable and workload'),
  ('faculty', 'Faculty', 'Own timetable and attendance posting'),
  ('exam_cell', 'Examination Cell', 'Exam command center'),
  ('auditor', 'Auditor', 'Read-only audit access'),
  ('system_admin', 'System Administrator', 'Roles and integrations')
ON DUPLICATE KEY UPDATE label = VALUES(label);

-- Dynamic RBAC (see migrate-rbac-permissions.ts for full seed of ap_permissions / ap_role_permissions)
-- ALTER / CREATE applied by: npm run db:migrate:rbac


INSERT INTO ap_thresholds (key_name, key_value, description) VALUES
  ('attendance_risk_percent', '75', 'Students below this % are risk'),
  ('attendance_post_late_hours', '24', 'Hours after class when posting is late'),
  ('workload_max_periods_week', '20', 'Default max periods/week'),
  ('workload_min_periods_week', '8', 'Default min periods/week')
ON DUPLICATE KEY UPDATE description = VALUES(description);
